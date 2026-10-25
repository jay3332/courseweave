//! Past syllabi from the Canvas Syllabus Registry (ADR 24): CMU members only, read from S3-compatible object storage
//! or, in development, a local directory. PDFs open in the page, framed only by this site; every other type is only
//! ever downloaded, so nothing from the registry runs here. Ported from Courseweave's `serveSyllabus` and
//! `lib/syllabus-files.ts`.

use std::path::PathBuf;

use anyhow::Context;
use aws_sdk_s3::{
    Client,
    config::{BehaviorVersion, Credentials, Region},
};
use axum::{
    Extension,
    body::{Body, Bytes},
    extract::{Path, Query},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use utoipa::IntoParams;

use crate::{
    auth::CurrentUser,
    catalog::not_modified,
    error::{ApiError, ApiResult},
    state::AppState,
};

/// The types served, by extension.
pub const CONTENT_TYPES: [(&str, &str); 8] = [
    ("pdf", "application/pdf"),
    (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    ("doc", "application/msword"),
    (
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    ("odt", "application/vnd.oasis.opendocument.text"),
    ("rtf", "application/rtf"),
    ("txt", "text/plain; charset=utf-8"),
    ("html", "text/html; charset=utf-8"),
];

/// Shown in the page; everything else is downloaded.
const PREVIEWABLE: [&str; 1] = ["pdf"];

/// Files larger than this aren't served.
const FILE_MAX: u64 = 50 * 1024 * 1024;

/// The key's type, when it's one we serve.
pub fn syllabus_type(key: &str) -> Option<&'static str> {
    let (_, ext) = key.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    if ext.is_empty() || !ext.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return None;
    }
    CONTENT_TYPES
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(e, _)| *e)
}

/// `F25/MSC/21241-1.pdf`: a registry term, a department code and a file name with a known type.
pub fn is_syllabus_key(key: &str) -> bool {
    let mut parts = key.split('/');
    let (Some(term), Some(dept), Some(file), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    let term_ok = term.len() == 3
        && matches!(term.as_bytes()[0], b'S' | b'M' | b'N' | b'F')
        && term.as_bytes()[1..].iter().all(u8::is_ascii_digit);
    let dept_ok = (1..=6).contains(&dept.len())
        && dept
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    let file_ok = (1..=200).contains(&file.chars().count())
        && !file.starts_with('.')
        && !file.contains('\\')
        && !file.chars().any(char::is_control);
    term_ok && dept_ok && file_ok && syllabus_type(key).is_some()
}

pub enum SyllabusStore {
    Dir(PathBuf),
    S3 {
        client: Client,
        bucket: String,
        prefix: String,
    },
}

struct File {
    bytes: Bytes,
    etag: String,
}

impl SyllabusStore {
    /// From `SYLLABI_DIR`, or `SYLLABI_BUCKET` with its endpoint and keys; `None` when neither is set.
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let var = |name: &str| std::env::var(name).ok().filter(|v| !v.trim().is_empty());
        if let Some(dir) = var("SYLLABI_DIR") {
            return Ok(Some(Self::Dir(dir.into())));
        }
        let Some(bucket) = var("SYLLABI_BUCKET") else {
            return Ok(None);
        };
        let endpoint =
            var("SYLLABI_S3_ENDPOINT").unwrap_or_else(|| "https://s3.scottylabs.org".into());
        let region = var("SYLLABI_S3_REGION").unwrap_or_else(|| "us-east-1".into());
        let key_id = var("SYLLABI_ACCESS_KEY_ID")
            .context("SYLLABI_ACCESS_KEY_ID must be set with SYLLABI_BUCKET")?;
        let secret = var("SYLLABI_SECRET_ACCESS_KEY")
            .context("SYLLABI_SECRET_ACCESS_KEY must be set with SYLLABI_BUCKET")?;
        let config = aws_sdk_s3::config::Builder::new()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(region))
            .endpoint_url(endpoint)
            .credentials_provider(Credentials::new(key_id, secret, None, None, "syllabi"))
            .force_path_style(true)
            .build();
        Ok(Some(Self::S3 {
            client: Client::from_conf(config),
            bucket,
            // Empty is a real value: Courseweave's bucket keeps syllabi at its root.
            prefix: std::env::var("SYLLABI_PREFIX").unwrap_or_else(|_| "syllabi/".into()),
        }))
    }

    async fn get(&self, key: &str) -> ApiResult<Option<File>> {
        match self {
            Self::Dir(dir) => {
                let path = dir.join(key);
                let meta = match tokio::fs::metadata(&path).await {
                    Ok(meta) if meta.is_file() => meta,
                    Ok(_) => return Ok(None),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                    Err(e) => return Err(ApiError::internal(e)),
                };
                if meta.len() > FILE_MAX {
                    return Ok(None);
                }
                let modified = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_secs());
                let bytes = tokio::fs::read(&path).await.map_err(ApiError::internal)?;
                Ok(Some(File {
                    etag: format!("{:x}-{modified:x}", meta.len()),
                    bytes: bytes.into(),
                }))
            }
            Self::S3 {
                client,
                bucket,
                prefix,
            } => {
                let object = client
                    .get_object()
                    .bucket(bucket)
                    .key(format!("{prefix}{key}"))
                    .send()
                    .await;
                let object = match object {
                    Ok(object) => object,
                    Err(e) if e.as_service_error().is_some_and(|e| e.is_no_such_key()) => {
                        return Ok(None);
                    }
                    Err(e) => {
                        tracing::error!(error = %aws_sdk_s3::error::DisplayErrorContext(&e), "reading a syllabus failed");
                        return Err(ApiError::unavailable("Syllabi are unavailable right now."));
                    }
                };
                if object.content_length().is_some_and(|n| n as u64 > FILE_MAX) {
                    return Ok(None);
                }
                let etag = object
                    .e_tag()
                    .map(|t| t.trim_matches('"').to_owned())
                    .unwrap_or_default();
                let bytes = object
                    .body
                    .collect()
                    .await
                    .map_err(ApiError::internal)?
                    .into_bytes();
                Ok(Some(File { bytes, etag }))
            }
        }
    }
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SyllabusQuery {
    /// `1` downloads a PDF instead of showing it.
    pub download: Option<String>,
}

/// Header-safe `filename` and RFC 5987 `filename*` values.
fn disposition(inline: bool, name: &str) -> HeaderValue {
    let ascii: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let encoded: String = name
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    let kind = if inline { "inline" } else { "attachment" };
    HeaderValue::from_str(&format!(
        "{kind}; filename=\"{ascii}\"; filename*=UTF-8''{encoded}"
    ))
    .unwrap_or_else(|_| HeaderValue::from_static("attachment"))
}

/// A past syllabus file, for signed-in CMU users. PDFs are shown inline (`?download=1` downloads them); other types
/// are attachments. Saved as `<term>-<file>`.
#[utoipa::path(
    get,
    path = "/api/syllabi/{key}",
    tag = "syllabi",
    params(("key" = String, Path, description = "`<term>/<dept>/<file>`, such as `F25/MSC/21241-1.pdf`"), SyllabusQuery),
    responses(
        (status = OK, description = "The file"),
        (status = NOT_MODIFIED),
        (status = UNAUTHORIZED, body = crate::error::ErrorBody),
        (status = NOT_FOUND, body = crate::error::ErrorBody),
        (status = SERVICE_UNAVAILABLE, description = "Syllabus storage isn't configured", body = crate::error::ErrorBody),
    )
)]
pub async fn serve(
    _user: CurrentUser,
    Extension(state): Extension<AppState>,
    Path(key): Path<String>,
    Query(q): Query<SyllabusQuery>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let Some(ext) = syllabus_type(&key).filter(|_| is_syllabus_key(&key)) else {
        return Err(ApiError::not_found("No such syllabus."));
    };
    let store = state
        .syllabi
        .as_ref()
        .ok_or_else(|| ApiError::unavailable("Syllabi aren't set up on this deployment."))?;
    let file = store
        .get(&key)
        .await?
        .ok_or_else(|| ApiError::not_found("No such syllabus."))?;
    let inline = PREVIEWABLE.contains(&ext) && q.download.as_deref() != Some("1");
    let (term, rest) = key.split_once('/').unwrap_or(("", &key));
    let name = rest.rsplit('/').next().unwrap_or(rest);
    let content_type = CONTENT_TYPES
        .iter()
        .find(|(e, _)| *e == ext)
        .map_or("application/octet-stream", |(_, t)| t);
    let mut out = HeaderMap::new();
    out.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    out.insert(
        header::CONTENT_DISPOSITION,
        disposition(inline, &format!("{term}-{name}")),
    );
    out.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=3600"),
    );
    out.insert(header::VARY, HeaderValue::from_static("Cookie"));
    out.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if inline {
        out.insert(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("SAMEORIGIN"),
        );
        out.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("default-src 'none'; frame-ancestors 'self'"),
        );
    } else {
        out.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
        out.insert(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'; sandbox"),
        );
    }
    if !file.etag.is_empty() {
        if let Ok(etag) = HeaderValue::from_str(&format!("\"{}\"", file.etag)) {
            out.insert(header::ETAG, etag);
        }
        if not_modified(&headers, &file.etag) {
            return Ok((StatusCode::NOT_MODIFIED, out).into_response());
        }
    }
    Ok((out, Body::from(file.bytes)).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_follow_the_registry_layout() {
        for ok in [
            "F25/MSC/21241-1.pdf",
            "S24/CS/15122 syllabus.DOCX",
            "N24/A1/x.txt",
        ] {
            assert!(is_syllabus_key(ok), "{ok}");
        }
        for bad in [
            "F25/MSC/../../etc/passwd.pdf",
            "F25/MSC/.hidden.pdf",
            "F25/msc/a.pdf",
            "X25/MSC/a.pdf",
            "F25/MSC/a.exe",
            "F25/MSC/a",
            "F25/MSC/sub/a.pdf",
            "F25/TOOLONGX/a.pdf",
            "F25/MSC/a\\b.pdf",
            "/F25/MSC/a.pdf",
        ] {
            assert!(!is_syllabus_key(bad), "{bad}");
        }
        assert_eq!(syllabus_type("a/b/c.PDF"), Some("pdf"));
    }

    #[test]
    fn download_names_are_header_safe() {
        let v = disposition(false, "F25-a\"b\r\nc \u{e9}.pdf");
        let s = v.to_str().unwrap();
        assert!(s.starts_with("attachment; filename=\"F25-a_b__c _.pdf\""));
        assert!(s.contains("filename*=UTF-8''F25-a%22b%0D%0Ac%20%C3%A9.pdf"));
    }
}
