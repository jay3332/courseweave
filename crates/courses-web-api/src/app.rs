//! The router: API routes with their OpenAPI document, sign-in, search-engine files and the website, behind the
//! Origin guard, security headers and sessions.

use std::path::Path;

use axum::{
    Extension, Json, Router,
    extract::{DefaultBodyLimit, Request},
    http::{HeaderValue, Method, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Serialize;
use tower_http::{
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tower_sessions::{Expiry, SessionManagerLayer, cookie::SameSite};
use utoipa::{OpenApi, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};
use utoipa_scalar::{Scalar, Servable};

use crate::{
    account, auth, catalog, error, finals, friends, records, seo, sessions::SqliteStore,
    state::AppState, syllabi,
};

/// Request bodies are limited to this, as are stored records.
pub const BODY_LIMIT: usize = 128 * 1024;

#[derive(OpenApi)]
#[openapi(
    info(
        title = "CMU Courses web API",
        version = "0.1.0",
        description = "Same-origin API for cmu.courses. JSON field names are camelCase. Writes need an `Origin` \
            header equal to the site's origin. Errors are `{ code, message }`."
    ),
    paths(catalog::document, syllabi::serve, auth::login, auth::logout),
    components(schemas(error::ErrorBody, error::ErrorCode)),
    tags(
        (name = "health"),
        (name = "auth", description = "Sign-in and the account"),
        (name = "catalog", description = "Catalog documents (decision 16)"),
        (name = "courses", description = "The public course API"),
        (name = "schedules"),
        (name = "plans"),
        (name = "record", description = "The academic record"),
        (name = "preferences"),
        (name = "saved", description = "Saved courses"),
        (name = "friends"),
        (name = "finals", description = "Final exams imported from SIO"),
        (name = "syllabi"),
    )
)]
struct ApiDoc;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub status: String,
    pub catalog_schema: String,
}

/// 200 when the catalog opens with this build's schema and the user database takes writes.
#[utoipa::path(
    get,
    path = "/api/health",
    tag = "health",
    responses((status = OK, body = Health), (status = SERVICE_UNAVAILABLE, body = error::ErrorBody))
)]
async fn health(Extension(state): Extension<AppState>) -> error::ApiResult<Json<Health>> {
    let catalog_schema = state.catalog.check().await?;
    state.db.check_writable().await?;
    Ok(Json(Health {
        status: "ok".into(),
        catalog_schema,
    }))
}

/// Every JSON route, with its OpenAPI paths.
fn api() -> OpenApiRouter {
    use records::{documents, plans, saved, schedules};
    OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(health))
        .routes(routes!(auth::me))
        .routes(routes!(account::delete))
        .routes(routes!(catalog::courses::terms))
        .routes(routes!(catalog::courses::courses))
        .routes(routes!(catalog::courses::course))
        .routes(routes!(schedules::list_mine, schedules::create))
        .routes(routes!(schedules::update, schedules::delete))
        .routes(routes!(schedules::share, schedules::unshare))
        .routes(routes!(schedules::shared))
        .routes(routes!(plans::list, plans::create))
        .routes(routes!(plans::update, plans::delete))
        .routes(routes!(documents::get_record, documents::put_record))
        .routes(routes!(
            documents::get_preferences,
            documents::put_preferences
        ))
        .routes(routes!(saved::list))
        .routes(routes!(saved::save, saved::remove))
        .routes(routes!(friends::list, friends::send_request))
        .routes(routes!(friends::accept))
        .routes(routes!(friends::remove))
        .routes(routes!(friends::invite))
        .routes(routes!(friends::redeem))
        .routes(routes!(friends::invite_info, friends::revoke_invite))
        .routes(routes!(friends::get_sharing, friends::set_sharing))
        .routes(routes!(friends::friend_schedules))
        .routes(routes!(friends::friends_courses))
        .routes(routes!(finals::list))
        .routes(routes!(finals::import, finals::clear))
}

/// The OpenAPI document, without building a server.
pub fn openapi() -> utoipa::openapi::OpenApi {
    api().split_for_parts().1
}

/// Whether a write may come from `origin`: only `APP_URL`, except that local development sign-in (ADR 26) also
/// accepts other `http://localhost` ports, so several development servers can share one API.
fn origin_allowed(state: &AppState, origin: Option<&str>) -> bool {
    let Some(origin) = origin else { return false };
    #[cfg(feature = "dev-auth")]
    let local_dev = matches!(&state.auth, crate::auth::AuthMode::Dev(_)) && local_origin(origin);
    #[cfg(not(feature = "dev-auth"))]
    let local_dev = false;
    origin == state.origin || local_dev
}

/// `http://localhost:<port>` or `http://127.0.0.1:<port>`.
#[cfg_attr(not(feature = "dev-auth"), allow(dead_code))]
fn local_origin(origin: &str) -> bool {
    ["http://localhost:", "http://127.0.0.1:"]
        .iter()
        .any(|prefix| {
            origin
                .strip_prefix(prefix)
                .is_some_and(|port| !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()))
        })
}

/// Refuses writes from other origins and adds security and cache headers to dynamic responses.
async fn guard(Extension(state): Extension<AppState>, request: Request, next: Next) -> Response {
    let write = !matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    );
    if write
        && !origin_allowed(
            &state,
            request
                .headers()
                .get(header::ORIGIN)
                .and_then(|v| v.to_str().ok()),
        )
    {
        return error::ApiError::forbidden("Cross-site request refused.").into_response();
    }
    let api = {
        let path = request.uri().path();
        path.starts_with("/api/") || path.starts_with("/auth/")
    };
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
    if state.origin.starts_with("https://") {
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        );
    }
    if api {
        // A syllabus PDF may be framed by this site; nothing else may.
        headers
            .entry(header::X_FRAME_OPTIONS)
            .or_insert(HeaderValue::from_static("DENY"));
        let html = headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/html"));
        if !html {
            headers
                .entry(header::CONTENT_SECURITY_POLICY)
                .or_insert(HeaderValue::from_static(
                    "default-src 'none'; frame-ancestors 'none'",
                ));
        }
        headers
            .entry(header::CACHE_CONTROL)
            .or_insert(HeaderValue::from_static("no-store"));
        if !headers.contains_key(header::VARY) {
            headers.insert(header::VARY, HeaderValue::from_static("Cookie"));
        }
    }
    response
}

/// How sign-in works for this server.
pub enum SignIn {
    Oidc(Box<axum_oidc::OidcClient<auth::GroupClaims>>),
    /// Development or test sign-in, in `AppState::auth`; no OIDC layers.
    #[cfg_attr(not(any(test, feature = "dev-auth")), allow(dead_code))]
    Local,
}

pub fn router(state: AppState, sign_in: SignIn) -> Router {
    let (api, spec) = api().split_for_parts();
    let mut routes = Router::new()
        .merge(api)
        .route("/api/catalog/{*name}", get(catalog::document))
        .route("/api/syllabi/{*key}", get(syllabi::serve))
        .route("/auth/logout", get(auth::logout).post(auth::logout))
        .route("/sitemap.xml", get(seo::sitemap))
        .route("/robots.txt", get(seo::robots))
        .merge(Scalar::with_url("/api/scalar", spec.clone()))
        .route(
            "/api/openapi.json",
            get(move || {
                let spec = spec.clone();
                async move { Json(spec) }
            }),
        )
        .route(
            "/api/{*rest}",
            axum::routing::any(|| async { error::ApiError::not_found("No such route.") }),
        );
    if state.site.is_some() {
        routes = routes.route("/course/{code}", get(seo::course));
    }
    let login = Router::new().route("/auth/login", get(auth::login));
    let routes = match &sign_in {
        SignIn::Oidc(client) => {
            let login_layer = tower::ServiceBuilder::new()
                .layer(axum::error_handling::HandleErrorLayer::new(
                    |e: axum_oidc::error::MiddlewareError| async move {
                        tracing::error!(error = ?e, "OIDC login failed");
                        e.into_response()
                    },
                ))
                .layer(axum_oidc::OidcLoginLayer::<auth::GroupClaims, OidcSession>::new());
            routes
                .merge(login.route_layer(login_layer))
                .route(
                    "/auth/callback",
                    get(axum_oidc::handle_oidc_redirect::<auth::GroupClaims, OidcSession>),
                )
                .layer(
                    tower::ServiceBuilder::new()
                        .layer(axum::error_handling::HandleErrorLayer::new(
                            |e: axum_oidc::error::MiddlewareError| async move {
                                tracing::error!(error = ?e, "OIDC session check failed");
                                e.into_response()
                            },
                        ))
                        .layer(
                            axum_oidc::OidcAuthLayer::<auth::GroupClaims, OidcSession>::new(
                                (**client).clone(),
                            ),
                        ),
                )
        }
        SignIn::Local => routes.merge(login),
    };

    let store = SqliteStore::new(state.db.clone());
    let sessions = SessionManagerLayer::new(store)
        .with_name("cmu_courses_session")
        .with_secure(state.origin.starts_with("https://"))
        .with_same_site(SameSite::Lax)
        .with_expiry(Expiry::OnInactivity(
            tower_sessions::cookie::time::Duration::days(14),
        ));

    let app = routes
        .layer(middleware::from_fn(error::json_errors))
        .layer(middleware::from_fn(guard))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(sessions)
        .layer(Extension(state.clone()))
        .layer(
            TraceLayer::new_for_http().make_span_with(|request: &Request| {
                // The path only: query strings can hold OAuth codes.
                tracing::info_span!("request", method = %request.method(), path = %request.uri().path())
            }),
        );

    match &state.site {
        Some(site) => app.fallback_service(website(&site.dir)),
        None => app,
    }
}

/// The website's files. Build output under `/_app` that isn't there is a 404; any other path is the app's page, which
/// routes it. `website_cache` says how long each may be kept.
fn website(dir: &Path) -> Router {
    let pages = ServeDir::new(dir)
        .append_index_html_on_directories(true)
        .fallback(ServeFile::new(dir.join("index.html")));
    Router::new()
        .nest_service("/_app", ServeDir::new(dir.join("_app")))
        .fallback_service(pages)
        .layer(middleware::from_fn(website_cache))
}

/// Build output with content-hashed names (`/_app/immutable/`) may be kept for a year; everything else is checked again
/// each time, so a deploy shows at once; and an error, a missing file above all, is never kept. Missing build files
/// used to be answered with the app's page, which Cloudflare and browsers then kept for hours under the script's name:
/// when a later build brought that name back, they served the page in its place and the app failed to start.
async fn website_cache(request: Request, next: Next) -> Response {
    let immutable = request.uri().path().starts_with("/_app/immutable/");
    let mut response = next.run(request).await;
    let status = response.status();
    let policy = if !(status.is_success() || status == StatusCode::NOT_MODIFIED) {
        "no-store"
    } else if immutable {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static(policy));
    response
}

/// Bridges tower-sessions to axum-oidc's session storage.
pub struct OidcSession(tower_sessions::Session);

impl<S: Send + Sync> axum::extract::FromRequestParts<S> for OidcSession {
    type Rejection = <tower_sessions::Session as axum::extract::FromRequestParts<S>>::Rejection;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        Ok(Self(
            tower_sessions::Session::from_request_parts(parts, state).await?,
        ))
    }
}

impl<AC: axum_oidc::AdditionalClaims> axum_oidc::Session<AC> for OidcSession {
    type Error = tower_sessions::session::Error;

    async fn get(
        &self,
    ) -> Result<
        axum_oidc::OidcSession<AC, axum_oidc::openidconnect::core::CoreGenderClaim>,
        Self::Error,
    > {
        Ok(self.0.get("axum-oidc").await?.unwrap_or_default())
    }

    async fn set(
        &mut self,
        value: axum_oidc::OidcSession<AC, axum_oidc::openidconnect::core::CoreGenderClaim>,
    ) -> Result<(), Self::Error> {
        self.0.insert("axum-oidc", value).await?;
        Ok(())
    }
}

/// Deletes expired sessions hourly.
pub fn spawn_background(state: &AppState) {
    SqliteStore::new(state.db.clone()).spawn_cleanup();
}

#[cfg(test)]
mod origin_tests {
    use super::local_origin;

    #[test]
    fn local_origins_are_only_localhost_ports() {
        assert!(local_origin("http://localhost:5181"));
        assert!(local_origin("http://127.0.0.1:5173"));
        assert!(!local_origin("http://localhost"));
        assert!(!local_origin("http://localhost:5181.evil.test"));
        assert!(!local_origin("https://localhost:5181"));
        assert!(!local_origin("http://localhost.evil.test:80"));
    }
}
