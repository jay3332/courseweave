//! The CMU Courses web API: the website, catalog documents, the public course API and CMU students' personal records,
//! on one origin. `courses-web-api openapi` prints the OpenAPI document instead of serving.

mod account;
mod app;
mod auth;
mod catalog;
mod catalog_release;
mod db;
mod error;
mod finals;
mod friends;
mod imports;
mod ratelimit;
mod records;
mod seo;
mod sessions;
mod state;
mod syllabi;
#[cfg(test)]
mod tests;

use std::{path::PathBuf, time::Duration};

use anyhow::{Context, Result, anyhow, bail};
use axum_oidc::openidconnect::{ClientId, ClientSecret, CsrfToken, IssuerUrl, Scope};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Serialize;
use tokio::net::TcpListener;
use tracing::{info, warn};

use crate::{
    app::SignIn,
    auth::{AuthMode, GroupClaims, OidcConfig},
    catalog::Catalog,
    db::UserDb,
    ratelimit::Limiter,
    seo::Site,
    state::{AppState, Inner},
    syllabi::SyllabusStore,
};

/// Writes per signed-in user per minute.
const WRITES_PER_MINUTE: u32 = 60;

#[tokio::main]
async fn main() -> Result<()> {
    match std::env::args().nth(1).as_deref() {
        None | Some("serve") => serve().await,
        Some("openapi") => {
            println!("{}", app::openapi().to_pretty_json()?);
            Ok(())
        }
        Some(other) => bail!(
            "unknown command {other:?}: run without arguments to serve, or `openapi` to print the OpenAPI document"
        ),
    }
}

fn env(name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .with_context(|| format!("{name} must be set"))
}

/// OAuth2 state carrying the relay's return address and a random CSRF token.
#[derive(Serialize)]
struct RelayState<'a> {
    return_to: &'a str,
    csrf: uuid::Uuid,
}

fn relay_state(return_to: &str) -> String {
    let state = RelayState {
        return_to,
        csrf: uuid::Uuid::new_v4(),
    };
    URL_SAFE_NO_PAD.encode(serde_json::to_vec(&state).expect("serialize relay state"))
}

async fn oidc_client(
    config: OidcConfig,
    app_url: &str,
) -> Result<axum_oidc::OidcClient<GroupClaims>> {
    let issuer = IssuerUrl::new(config.issuer).context("the OIDC issuer must be a URL")?;
    let callback = format!("{app_url}/auth/callback");
    let client = axum_oidc::OidcClient::<GroupClaims>::builder()
        .with_default_http_client()
        .with_redirect_url(
            axum::http::Uri::try_from(config.oauth_relay_url)
                .context("OAUTH_RELAY_URL must be a URL")?,
        )
        .with_client_id(ClientId::new(config.client_id))
        .with_client_secret(ClientSecret::new(config.client_secret))
        .with_scopes(vec![
            Scope::new("openid".into()),
            Scope::new("email".into()),
            Scope::new("profile".into()),
        ])
        .with_state_generator(move || CsrfToken::new(relay_state(&callback)))
        .discover(issuer)
        .await
        .map_err(|e| anyhow!("OIDC discovery failed: {e}"))?
        .build();
    info!("OIDC discovery completed");
    Ok(client)
}

/// Development sign-in when compiled in and configured; otherwise Keycloak.
async fn sign_in(app_url: &str) -> Result<(AuthMode, SignIn)> {
    #[cfg(feature = "dev-auth")]
    if let Some(dev) = auth::dev::DevAuth::from_env(app_url)? {
        warn!(
            user = dev.andrew_id(),
            "DEVELOPMENT SIGN-IN: every request is this CMU user; Keycloak is not used"
        );
        return Ok((AuthMode::Dev(dev), SignIn::Local));
    }
    if std::env::var_os("DEV_USER").is_some() && !cfg!(feature = "dev-auth") {
        warn!("DEV_USER is set but this build lacks the dev-auth feature; using Keycloak");
    }
    // OIDC_ISSUER names any provider (Google for a personal instance); otherwise Keycloak's realm.
    let issuer = match std::env::var("OIDC_ISSUER")
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        Some(issuer) => issuer.trim().trim_end_matches('/').to_owned(),
        None => format!("{}/realms/{}", env("KEYCLOAK_URL")?, env("KEYCLOAK_REALM")?),
    };
    let config = OidcConfig {
        issuer,
        client_id: env("OIDC_CLIENT_ID")?,
        client_secret: env("OIDC_CLIENT_SECRET")?,
        oauth_relay_url: env("OAUTH_RELAY_URL")?,
    };
    let client = oidc_client(config, app_url).await?;
    Ok((AuthMode::Oidc, SignIn::Oidc(Box::new(client))))
}

async fn serve() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let port = std::env::var("PORT").unwrap_or_else(|_| "3002".into());
    let app_url = env("APP_URL")?.trim_end_matches('/').to_owned();

    // Kennel provisions DATABASE_PATH; USER_DB_PATH overrides it; local development uses data/private.
    let managed_db = std::env::var_os("DATABASE_PATH")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from);
    let user_db = std::env::var_os("USER_DB_PATH")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .or_else(|| managed_db.clone())
        .unwrap_or_else(|| "data/private/users.sqlite".into());

    let catalog_path = catalog_release::prepare(managed_db.as_deref()).await?;
    let catalog = Catalog::open(&catalog_path)?;
    let db = UserDb::open(&user_db)?;
    let (auth, sign_in) = sign_in(&app_url).await?;
    let site = match std::env::var_os("STATIC_DIR").filter(|d| !d.is_empty()) {
        Some(dir) => Some(Site::load(&PathBuf::from(dir))?),
        None => None,
    };
    let syllabi = SyllabusStore::from_env()?;
    if syllabi.is_none() {
        warn!(
            "syllabi aren't configured (SYLLABI_DIR or SYLLABI_BUCKET); /api/syllabi answers 503"
        );
    }

    let state = AppState::new(Inner {
        catalog,
        db,
        origin: app_url,
        admin_group: std::env::var("PROJECT_ADMIN_GROUP").unwrap_or_default(),
        auth,
        syllabi,
        site,
        writes: Limiter::new(WRITES_PER_MINUTE, Duration::from_secs(60)),
    });
    app::spawn_background(&state);
    info!(
        catalog = %catalog_path.display(),
        user_db = %user_db.display(),
        website = state.site.is_some(),
        "starting"
    );
    let router = app::router(state, sign_in);
    // HOST=127.0.0.1 keeps a personal instance reachable only through its tunnel or proxy.
    let host = std::env::var("HOST").unwrap_or_else(|_| "0.0.0.0".into());
    let addr = format!("{host}:{port}");
    let listener = TcpListener::bind(&addr).await?;
    info!(addr = %addr, "listening");
    axum::serve(listener, router).await?;
    Ok(())
}
