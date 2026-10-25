//! Who is calling. OIDC (Keycloak, or Google for a personal instance) establishes identity, and only a verified CMU email makes a member. `CurrentUser`
//! requires a member (401 or 403 otherwise), `Viewer` reports what kind of caller this is, and `Writer` is a member
//! within the per-user write limit.

#[cfg(feature = "dev-auth")]
pub mod dev;

use axum::{
    Extension, Json,
    extract::{FromRequestParts, Query},
    http::{HeaderValue, Method, StatusCode, header, request::Parts},
    response::{IntoResponse, Redirect, Response},
};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;
use utoipa::{IntoParams, ToSchema};

use crate::{
    error::{ApiError, ApiResult},
    friends::register_profile,
    state::AppState,
};

pub struct OidcConfig {
    /// The provider's issuer: `OIDC_ISSUER` (such as `https://accounts.google.com`), or Keycloak's realm URL.
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    pub oauth_relay_url: String,
}

/// Group memberships carried on the OIDC token as full paths.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupClaims {
    #[serde(default)]
    pub groups: Vec<String>,
}

impl axum_oidc::openidconnect::AdditionalClaims for GroupClaims {}
impl axum_oidc::AdditionalClaims for GroupClaims {}

/// How requests are signed in.
pub enum AuthMode {
    /// Keycloak, through `axum-oidc`'s session.
    Oidc,
    /// Local development without Keycloak (ADR 26).
    #[cfg(feature = "dev-auth")]
    Dev(dev::DevAuth),
    /// Tests name the caller in an `x-test-user` header.
    #[cfg(test)]
    Test,
}

/// The session key holding the signed-in subject, so the session store can find a user's sessions.
pub const SESSION_SUBJECT: &str = "subject";

/// The session key holding the member verified at sign-in. Google's ID tokens last an hour and come without a refresh
/// token, so after one expires the session vouches for the member it verified, for as long as the session lasts.
const SESSION_MEMBER: &str = "member";

/// A signed-in CMU member.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CurrentUser {
    /// The OIDC subject: the owner key of every personal record.
    pub subject: String,
    pub name: String,
    pub email: String,
    pub andrew_id: String,
    pub groups: Vec<String>,
}

impl CurrentUser {
    pub fn is_admin(&self, admin_group: &str) -> bool {
        !admin_group.is_empty() && self.groups.iter().any(|g| g == admin_group)
    }
}

/// A verified email at `cmu.edu` or one of its subdomains. Project groups never establish CMU affiliation.
pub fn verified_cmu_email(email: Option<&str>, verified: bool) -> bool {
    verified
        && email.is_some_and(|email| {
            email
                .to_ascii_lowercase()
                .rsplit_once('@')
                .is_some_and(|(local, domain)| {
                    !local.is_empty() && (domain == "cmu.edu" || domain.ends_with(".cmu.edu"))
                })
        })
}

/// Builds the member from identity claims: 403 unless the email is a verified CMU address.
pub fn member(
    subject: String,
    email: Option<&str>,
    verified: bool,
    name: Option<String>,
    groups: Vec<String>,
) -> ApiResult<CurrentUser> {
    if !verified_cmu_email(email, verified) {
        return Err(ApiError::forbidden(
            "Sign in with a CMU account to use this.",
        ));
    }
    let email = email.unwrap_or_default().to_ascii_lowercase();
    let andrew_id = email.split('@').next().unwrap_or_default().to_owned();
    Ok(CurrentUser {
        name: name
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| andrew_id.clone()),
        subject,
        email,
        andrew_id,
        groups,
    })
}

async fn identify<S: Send + Sync>(
    parts: &mut Parts,
    state: &S,
    app: &AppState,
) -> ApiResult<CurrentUser> {
    match &app.auth {
        AuthMode::Oidc => {
            let session = parts.extensions.get::<Session>().cloned();
            let Ok(claims) =
                axum_oidc::OidcClaims::<GroupClaims>::from_request_parts(parts, state).await
            else {
                // The ID token expired: the member this session verified, if any.
                if let Some(session) = session
                    && let Ok(Some(user)) = session.get::<CurrentUser>(SESSION_MEMBER).await
                {
                    return Ok(user);
                }
                return Err(ApiError::auth());
            };
            let name = claims
                .name()
                .and_then(|n| n.get(None))
                .map(|n| n.as_str().to_owned())
                .or_else(|| claims.preferred_username().map(|u| u.as_str().to_owned()));
            let user = member(
                claims.subject().to_string(),
                claims.email().map(|e| e.as_str()),
                claims.email_verified() == Some(true),
                name,
                claims.additional_claims().groups.clone(),
            )?;
            if let Some(session) = session
                && session.get::<CurrentUser>(SESSION_MEMBER).await.ok().flatten().as_ref() != Some(&user)
                && let Err(e) = session.insert(SESSION_MEMBER, &user).await
            {
                tracing::warn!(error = %e, "keeping the member in the session failed");
            }
            Ok(user)
        }
        #[cfg(feature = "dev-auth")]
        AuthMode::Dev(dev) => dev.user(parts),
        #[cfg(test)]
        AuthMode::Test => {
            let who = parts
                .headers
                .get("x-test-user")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(ApiError::auth)?;
            let email = if who.contains('@') {
                who.to_owned()
            } else {
                format!("{who}@andrew.cmu.edu")
            };
            member(who.to_owned(), Some(&email), true, None, vec![])
        }
    }
}

fn app_state(parts: &Parts) -> ApiResult<AppState> {
    parts
        .extensions
        .get::<AppState>()
        .cloned()
        .ok_or_else(|| ApiError::internal("AppState extension missing"))
}

impl<S: Send + Sync> FromRequestParts<S> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app = app_state(parts)?;
        let user = identify(parts, state, &app).await?;
        // Tag the session with its owner, once, so deleting an account can sign out its other sessions.
        if let Some(session) = parts.extensions.get::<Session>()
            && let Err(e) = session.insert(SESSION_SUBJECT, &user.subject).await
        {
            tracing::warn!(error = %e, "tagging the session failed");
        }
        Ok(user)
    }
}

/// Who is calling, without requiring sign-in.
pub enum Viewer {
    Anonymous,
    /// Signed in, but not with a verified CMU email.
    NonCmu,
    Member,
}

impl Viewer {
    pub fn is_member(&self) -> bool {
        matches!(self, Viewer::Member)
    }
}

impl<S: Send + Sync> FromRequestParts<S> for Viewer {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        match CurrentUser::from_request_parts(parts, state).await {
            Ok(_) => Ok(Viewer::Member),
            Err(e) if e.status == StatusCode::FORBIDDEN => Ok(Viewer::NonCmu),
            Err(e) if e.status == StatusCode::UNAUTHORIZED => Ok(Viewer::Anonymous),
            Err(e) => Err(e),
        }
    }
}

/// A member making a change, within the per-user write limit.
pub struct Writer(pub CurrentUser);

impl<S: Send + Sync> FromRequestParts<S> for Writer {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user = CurrentUser::from_request_parts(parts, state).await?;
        app_state(parts)?.writes.check(
            &user.subject,
            "Too many changes at once; saving will resume shortly.",
        )?;
        Ok(Writer(user))
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    /// The OIDC subject.
    pub subject: String,
    pub name: String,
    pub andrew_id: String,
    pub email: String,
    pub is_admin: bool,
}

/// The signed-in CMU user.
#[utoipa::path(
    get,
    path = "/api/me",
    tag = "auth",
    responses(
        (status = OK, body = Me),
        (status = UNAUTHORIZED, description = "Not signed in", body = crate::error::ErrorBody),
        (status = FORBIDDEN, description = "Signed in without a verified CMU email", body = crate::error::ErrorBody),
    )
)]
pub async fn me(user: CurrentUser, Extension(state): Extension<AppState>) -> ApiResult<Json<Me>> {
    register_profile(&state, &user).await?;
    Ok(Json(Me {
        is_admin: user.is_admin(&state.admin_group),
        subject: user.subject,
        name: user.name,
        andrew_id: user.andrew_id,
        email: user.email,
    }))
}

/// A same-site path to return to after signing in; anything else becomes `/`.
pub fn safe_return_to(value: Option<&str>) -> String {
    let Some(value) = value else {
        return "/".into();
    };
    let path = value.split(['?', '#']).next().unwrap_or("");
    let ok = value.len() <= 2048
        && value.starts_with('/')
        && !value.starts_with("//")
        && !value.chars().any(|c| c.is_control() || c == '\\')
        && !path
            .split('/')
            .any(|segment| segment == "." || segment == ".." || segment.contains('%'))
        && path != "/auth"
        && !path.starts_with("/auth/");
    if ok { value.to_owned() } else { "/".into() }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct LoginQuery {
    /// A path on this site to return to afterwards. Defaults to `/`.
    #[serde(rename = "returnTo")]
    pub return_to: Option<String>,
    /// Development sign-in only: the Andrew ID to act as.
    #[serde(rename = "as")]
    pub as_user: Option<String>,
}

/// Starts sign-in. With Keycloak, the login layer has already completed the OIDC flow by the time this runs, so it
/// only redirects to `returnTo`.
#[utoipa::path(get, path = "/auth/login", tag = "auth", params(LoginQuery), responses((status = SEE_OTHER)))]
pub async fn login(Extension(state): Extension<AppState>, Query(q): Query<LoginQuery>) -> Response {
    let target = safe_return_to(q.return_to.as_deref());
    #[cfg(feature = "dev-auth")]
    if let AuthMode::Dev(_) = &state.auth {
        return dev::login(q.as_user.as_deref(), &target);
    }
    let _ = (&state, &q.as_user);
    Redirect::to(&target).into_response()
}

/// Signs out: `POST` answers 204, `GET` redirects home.
#[utoipa::path(
    post,
    path = "/auth/logout",
    tag = "auth",
    responses((status = NO_CONTENT), (status = FORBIDDEN, description = "Origin isn't APP_URL", body = crate::error::ErrorBody))
)]
pub async fn logout(
    method: Method,
    Extension(state): Extension<AppState>,
    session: Option<Extension<Session>>,
) -> Response {
    if let Some(Extension(session)) = session
        && let Err(e) = session.flush().await
    {
        tracing::warn!(error = %e, "flushing the session failed");
    }
    let mut response = if method == Method::GET {
        Redirect::to("/").into_response()
    } else {
        StatusCode::NO_CONTENT.into_response()
    };
    #[cfg(feature = "dev-auth")]
    if let AuthMode::Dev(_) = &state.auth {
        response
            .headers_mut()
            .append(header::SET_COOKIE, dev::signed_out_cookie());
    }
    let _ = &state;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn university_identity_requires_verified_exact_domain() {
        assert!(verified_cmu_email(Some("user@andrew.cmu.edu"), true));
        assert!(verified_cmu_email(Some("user@CMU.EDU"), true));
        assert!(!verified_cmu_email(Some("user@cmu.edu.evil.test"), true));
        assert!(!verified_cmu_email(Some("user@notcmu.edu"), true));
        assert!(!verified_cmu_email(Some("@cmu.edu"), true));
        assert!(!verified_cmu_email(Some("user@cmu.edu"), false));
        assert!(!verified_cmu_email(None, true));
    }

    #[test]
    fn admin_needs_a_configured_group() {
        let user = member(
            "s".into(),
            Some("a@andrew.cmu.edu"),
            true,
            None,
            vec![String::new()],
        )
        .unwrap();
        assert!(!user.is_admin(""));
        assert_eq!(user.andrew_id, "a");
        assert_eq!(user.name, "a");
    }

    #[test]
    fn return_paths_stay_on_this_site() {
        for ok in ["/", "/schedules?term=S27", "/course/15-122#fce"] {
            assert_eq!(safe_return_to(Some(ok)), ok);
        }
        for bad in [
            "https://evil.test",
            "//evil.test",
            "/\\evil.test",
            "/.//evil.test",
            "/a/../..//evil.test",
            "/%2e%2e//evil.test",
            "/auth/login",
            "/auth",
            "relative",
            "/a\nb",
        ] {
            assert_eq!(safe_return_to(Some(bad)), "/", "{bad}");
        }
        assert_eq!(safe_return_to(None), "/");
    }
}
