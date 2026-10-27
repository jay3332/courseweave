//! Search-engine files (ADR 25), ported from Courseweave's `scripts/build-seo.ts`. `/course/{code}` serves the
//! website's `index.html` with that course's title, description, canonical link, Open Graph tags and schema.org
//! `Course` data in the head, plus a plain summary in `<noscript>`; the body is otherwise the website's own. Only
//! public catalog fields are used, from the relational tables, which hold nothing else.

use std::path::{Path, PathBuf};

use anyhow::Context;
use axum::{
    Extension,
    extract::Path as UrlPath,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use rusqlite::{Connection, OptionalExtension};

use crate::{
    db::course_id_from_code,
    error::{ApiError, ApiResult},
    state::AppState,
};

const DESCRIPTION_MAX: usize = 158;
const SITE_NAME: &str = "CMU Courses";

/// The built website.
pub struct Site {
    pub dir: PathBuf,
    template: String,
}

impl Site {
    pub fn load(dir: &Path) -> anyhow::Result<Self> {
        let index = dir.join("index.html");
        let template = std::fs::read_to_string(&index)
            .with_context(|| format!("reading {} (STATIC_DIR)", index.display()))?;
        Ok(Self {
            dir: dir.to_owned(),
            template,
        })
    }
}

/// A course's public fields, as the head tags need them.
#[derive(Debug)]
pub struct SeoCourse {
    pub code: String,
    pub title: String,
    pub units: Option<f64>,
    pub units_max: Option<f64>,
    pub description: Option<String>,
    pub prerequisites: Option<String>,
    /// Term names, newest first.
    pub offered: Vec<String>,
}

pub fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

/// Collapses whitespace and cuts at a word boundary, with `...` when cut.
pub fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let cut: String = flat.chars().take(max - 3).collect();
    let floor = max * 3 / 5;
    let at = cut.rfind(' ').filter(|&i| i >= floor).unwrap_or(cut.len());
    format!(
        "{}...",
        cut[..at].trim_end_matches(|c: char| c.is_whitespace() || ",;:.".contains(c))
    )
}

fn number(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{n:.0}")
    } else {
        n.to_string()
    }
}

fn units_text(c: &SeoCourse) -> String {
    match (c.units, c.units_max) {
        (None, _) => "variable units".into(),
        (Some(u), Some(max)) if max > u => format!("{}-{} units", number(u), number(max)),
        (Some(u), _) => format!("{} units", number(u)),
    }
}

fn prerequisites(c: &SeoCourse) -> Option<&str> {
    c.prerequisites
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("none"))
}

/// The search snippet: what the course is, then the start of its description.
pub fn course_description(c: &SeoCourse) -> String {
    let lead = format!(
        "{} {}, {} at Carnegie Mellon University.",
        c.code,
        c.title,
        units_text(c)
    );
    let text = match c.description.as_deref().filter(|d| !d.trim().is_empty()) {
        Some(d) => format!("{lead} {d}"),
        None => format!("{lead} Prerequisites, sections and requirements on {SITE_NAME}."),
    };
    clip(&text, DESCRIPTION_MAX)
}

/// JSON for a `<script>` element: `<` escaped so the text can't close it.
fn script_json(value: &serde_json::Value) -> String {
    value.to_string().replace('<', "\\u003c")
}

/// Removes `<tag ...>` elements whose text matches `pred`.
fn strip_tags(html: &str, tag: &str, pred: impl Fn(&str) -> bool) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find(tag) {
        let Some(len) = rest[start..].find('>') else {
            break;
        };
        let element = &rest[start..=start + len];
        out.push_str(&rest[..start]);
        if !pred(element) {
            out.push_str(element);
        }
        rest = &rest[start + len + 1..];
    }
    out.push_str(rest);
    out
}

/// `index.html` with a course's head tags and `<noscript>` summary, or `None` when the template doesn't have the
/// expected shape.
pub fn course_page(template: &str, origin: &str, c: &SeoCourse) -> Option<String> {
    let url = format!("{origin}/course/{}", c.code);
    let name = format!("{} {}", c.code, c.title);
    let title = format!("{name} | {SITE_NAME}");
    let description = course_description(c);
    let mut ld = serde_json::json!({
        "@context": "https://schema.org",
        "@type": "Course",
        "name": c.title,
        "courseCode": c.code,
        "url": url,
        "provider": {
            "@type": "CollegeOrUniversity",
            "name": "Carnegie Mellon University",
            "sameAs": "https://www.cmu.edu",
        },
    });
    if let Some(d) = c.description.as_deref().filter(|d| !d.trim().is_empty()) {
        ld["description"] = clip(d, 1000).into();
    }
    if let Some(p) = prerequisites(c) {
        ld["coursePrerequisites"] = p.into();
    }
    let url_attr = escape_html(&url);
    let head = [
        format!("<link rel=\"canonical\" href=\"{url_attr}\" />"),
        format!(
            "<meta name=\"description\" content=\"{}\" />",
            escape_html(&description)
        ),
        "<meta property=\"og:type\" content=\"website\" />".to_owned(),
        format!("<meta property=\"og:site_name\" content=\"{SITE_NAME}\" />"),
        format!("<meta property=\"og:url\" content=\"{url_attr}\" />"),
        format!(
            "<meta property=\"og:title\" content=\"{}\" />",
            escape_html(&name)
        ),
        format!(
            "<meta property=\"og:description\" content=\"{}\" />",
            escape_html(&description)
        ),
        // The website's social image (sites/web/static/og-image.png), at its full address as Open Graph wants it.
        format!(
            "<meta property=\"og:image\" content=\"{}/og-image.png\" />",
            escape_html(origin)
        ),
        "<meta property=\"og:image:width\" content=\"1200\" />".to_owned(),
        "<meta property=\"og:image:height\" content=\"630\" />".to_owned(),
        format!(
            "<script type=\"application/ld+json\">{}</script>",
            script_json(&ld)
        ),
    ]
    .join("\n    ");
    let summary = [
        Some(format!("<h1>{}</h1>", escape_html(&name))),
        Some(format!(
            "<p>{}, Carnegie Mellon University</p>",
            escape_html(&units_text(c))
        )),
        c.description
            .as_deref()
            .filter(|d| !d.trim().is_empty())
            .map(|d| format!("<p>{}</p>", escape_html(d))),
        Some(format!(
            "<p>Prerequisites: {}</p>",
            escape_html(prerequisites(c).unwrap_or("none listed"))
        )),
        (!c.offered.is_empty())
            .then(|| format!("<p>Offered: {}</p>", escape_html(&c.offered.join(", ")))),
        Some(format!(
            "<p>{SITE_NAME} needs JavaScript to show sections, schedules and planning tools.</p>"
        )),
    ]
    .into_iter()
    .flatten()
    .collect::<String>();

    // The website's own description, canonical link and social tags give way to the course's.
    let html = strip_tags(template, "<meta", |el| {
        el.contains("name=\"description\"") || el.contains("property=\"og:")
    });
    let mut html = strip_tags(&html, "<link", |el| el.contains("rel=\"canonical\""));
    let title_tag = format!("<title>{}</title>", escape_html(&title));
    match (html.find("<title>"), html.find("</title>")) {
        (Some(start), Some(end)) if end > start => {
            html.replace_range(start..end + "</title>".len(), &title_tag);
        }
        _ => {
            let at = html.find("</head>")?;
            html.insert_str(at, &format!("  {title_tag}\n  "));
        }
    }
    let at = html.find("</head>")?;
    html.insert_str(at, &format!("  {head}\n  "));
    let body = html.find("<body")?;
    let open_end = body + html[body..].find('>')? + 1;
    html.insert_str(
        open_end,
        &format!("\n    <noscript><main>{summary}</main></noscript>"),
    );
    Some(html)
}

pub fn load_course(db: &Connection, id: &str) -> ApiResult<Option<SeoCourse>> {
    let course = db
        .query_row(
            "SELECT code, title, units, units_max, description, prerequisites FROM courses WHERE id = ?",
            [id],
            |r| {
                Ok(SeoCourse {
                    code: r.get(0)?,
                    title: r.get(1)?,
                    units: r.get(2)?,
                    units_max: r.get(3)?,
                    description: r.get(4)?,
                    prerequisites: r.get(5)?,
                    offered: vec![],
                })
            },
        )
        .optional()?;
    let Some(mut course) = course else {
        return Ok(None);
    };
    let mut stmt = db.prepare_cached(
        "SELECT t.name FROM offerings o JOIN terms t ON t.id = o.term_id WHERE o.course_id = ? ORDER BY t.position",
    )?;
    course.offered = stmt
        .query_map([id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(Some(course))
}

fn html_response(html: String) -> Response {
    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/html; charset=utf-8"),
            ),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-cache")),
        ],
        html,
    )
        .into_response()
}

/// The website for a course page, with the course's head tags. Unknown courses get the plain website.
pub async fn course(
    Extension(state): Extension<AppState>,
    UrlPath(code): UrlPath<String>,
) -> ApiResult<Response> {
    let site = state
        .site
        .as_ref()
        .ok_or_else(|| ApiError::not_found("No website is served here."))?;
    let course = match course_id_from_code(&code) {
        Some(id) => {
            state
                .catalog
                .with(move |r| load_course(r.connection(), &id))
                .await?
        }
        None => None,
    };
    let page = course
        .filter(|c| !looks_like_code(&c.title))
        .and_then(|c| course_page(&site.template, &state.origin, &c));
    Ok(html_response(page.unwrap_or_else(|| site.template.clone())))
}

/// Catalog entries titled with just their number would be empty pages.
fn looks_like_code(title: &str) -> bool {
    let t = title.trim();
    course_id_from_code(t).is_some() && t.len() <= 6
}

pub fn sitemap_xml(urls: &[(String, Option<String>)]) -> String {
    let rows: Vec<String> = urls
        .iter()
        .map(|(loc, lastmod)| {
            let lastmod = lastmod
                .as_deref()
                .map(|d| format!("<lastmod>{d}</lastmod>"))
                .unwrap_or_default();
            format!("  <url><loc>{}</loc>{lastmod}</url>", escape_html(loc))
        })
        .collect();
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n{}\n</urlset>\n",
        rows.join("\n")
    )
}

/// The build date from the catalog's `meta`, as `YYYY-MM-DD`.
fn build_date(value: Option<String>) -> Option<String> {
    let v = value?;
    let date = v.get(..10)?;
    let b = date.as_bytes();
    let ok = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    ok.then(|| date.to_owned())
}

/// The home page and every course worth a page: offered in a term, or described in the catalog.
pub async fn sitemap(Extension(state): Extension<AppState>) -> ApiResult<Response> {
    let origin = state.origin.clone();
    let xml = state
        .catalog
        .with(move |r| {
            let lastmod = build_date(r.meta("built_at")?.or(r.meta("build_time")?));
            let mut urls = vec![(format!("{origin}/"), None)];
            let mut stmt = r.connection().prepare(
                "SELECT c.code, c.title FROM courses c
                 WHERE coalesce(trim(c.description), '') <> ''
                    OR EXISTS (SELECT 1 FROM offerings o WHERE o.course_id = c.id)
                 ORDER BY c.id",
            )?;
            let rows =
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (code, title) = row?;
                if !looks_like_code(&title) {
                    urls.push((format!("{origin}/course/{code}"), lastmod.clone()));
                }
            }
            Ok(sitemap_xml(&urls))
        })
        .await?;
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/xml; charset=utf-8"),
            ),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=3600"),
            ),
        ],
        xml,
    )
        .into_response())
}

/// Keeps crawlers to the public course pages.
pub async fn robots(Extension(state): Extension<AppState>) -> Response {
    let body = format!(
        "User-agent: *\nDisallow: /api/\nDisallow: /auth/\nDisallow: /schedules\nDisallow: /plan\nDisallow: /profile\nDisallow: /finals\nDisallow: /instructors\n\nSitemap: {}/sitemap.xml\n",
        state.origin
    );
    (
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            ),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=3600"),
            ),
        ],
        body,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    pub const TEMPLATE: &str = "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"description\" content=\"Generic\" />\n    <meta property=\"og:title\" content=\"Generic\" />\n    <title>CMU Courses</title>\n  </head>\n  <body data-sveltekit-preload-data=\"hover\">\n    <div style=\"display: contents\"></div>\n  </body>\n</html>\n";

    fn course() -> SeoCourse {
        SeoCourse {
            code: "15-122".into(),
            title: "Principles of <script>alert(1)</script> & \"Computation\"".into(),
            units: Some(12.0),
            units_max: None,
            description: Some("Uses </script><script>alert(2)</script> and ' quotes".into()),
            prerequisites: Some("15-112".into()),
            offered: vec!["Spring 2027".into(), "Fall 2026".into()],
        }
    }

    #[test]
    fn injects_escaped_head_tags_and_summary() {
        let html = course_page(TEMPLATE, "https://cmu.courses", &course()).unwrap();
        assert!(
            html.contains("<link rel=\"canonical\" href=\"https://cmu.courses/course/15-122\" />")
        );
        assert!(html.contains(
            "<title>15-122 Principles of &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Computation&quot; | CMU Courses</title>"
        ));
        assert!(!html.contains("Generic"));
        assert!(!html.contains("<script>alert"));
        assert!(html.contains("\\u003c/script>\\u003cscript>alert(2)"));
        assert_eq!(html.matches("</script>").count(), 1);
        assert!(html.contains("&#39; quotes"));
        assert!(html.contains("<noscript><main><h1>15-122 Principles"));
        assert!(html.contains("Offered: Spring 2027, Fall 2026"));
        assert!(html.contains(
            "<meta property=\"og:image\" content=\"https://cmu.courses/og-image.png\" />"
        ));
        assert!(html.contains("12 units"));
        let ld_start =
            html.find("application/ld+json\">").unwrap() + "application/ld+json\">".len();
        let ld_end = html[ld_start..].find("</script>").unwrap() + ld_start;
        let ld: serde_json::Value = serde_json::from_str(&html[ld_start..ld_end]).unwrap();
        assert_eq!(ld["@type"], "Course");
        assert_eq!(ld["courseCode"], "15-122");
        assert_eq!(ld["coursePrerequisites"], "15-112");
    }

    #[test]
    fn unexpected_templates_fall_back() {
        assert!(course_page("<html>no head</html>", "https://x", &course()).is_none());
    }

    #[test]
    fn descriptions_are_clipped_at_words() {
        let long = "word ".repeat(100);
        let clipped = clip(&long, 40);
        assert!(
            clipped.len() <= 40 && clipped.ends_with("word..."),
            "{clipped}"
        );
        assert_eq!(clip("  short   text ", 40), "short text");
        let mut c = course();
        c.units = Some(4.5);
        c.units_max = Some(12.0);
        assert_eq!(units_text(&c), "4.5-12 units");
        assert!(course_description(&c).len() <= DESCRIPTION_MAX);
    }

    #[test]
    fn sitemaps_escape_locations() {
        let xml = sitemap_xml(&[("https://x/?a=1&b=2".into(), Some("2026-10-24".into()))]);
        assert!(xml.contains("<loc>https://x/?a=1&amp;b=2</loc><lastmod>2026-10-24</lastmod>"));
        assert_eq!(
            build_date(Some("2026-10-24T12:00:00Z".into())).as_deref(),
            Some("2026-10-24")
        );
        assert_eq!(build_date(Some("yesterday".into())), None);
        assert!(looks_like_code("15-122") && !looks_like_code("Intro"));
    }
}
