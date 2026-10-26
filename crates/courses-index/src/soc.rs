//! Parsers for CMU's public Schedule of Classes (SOC, `enr-apps.as.cmu.edu/open/SOC/SOCServlet`), shared by the
//! builder and `courses-scraper --mode soc`. Ports Courseweave's `scripts/lib/soc-parse.ts` and the SOC parts of
//! `scripts/build-catalog.ts`. No I/O here.

use std::sync::LazyLock;

use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};

use crate::js::{self, ser_opt_num};

fn re(pattern: &str) -> Regex {
    Regex::new(&pattern.replace("{WS}", js::WS)).expect("valid regex")
}

/// One `<tr>` of the search results. Continuation rows (more meetings, more sections) have an empty `course`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SocRow {
    /// Department title of the table the row is in, such as `COMPUTER SCIENCE`.
    pub department: String,
    pub course: String,
    pub title: String,
    /// Summer only: `summer`, `summer one`, `qatar summer`, ...
    pub session: String,
    pub units: String,
    pub section: String,
    /// `Y`, `N` or empty.
    pub mini: String,
    pub days: String,
    pub begin: String,
    pub end: String,
    /// Campus, such as `Pittsburgh, Pennsylvania`.
    pub location: String,
    /// Delivery mode label, such as `In-person Expectation`.
    pub mode: String,
}

static ENTITY: LazyLock<Regex> =
    LazyLock::new(|| re(r"&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z]+[0-9]*);"));

/// Decodes character references and named entities, as Courseweave's `decodeHtml`. Non-breaking spaces become spaces.
pub fn decode_html(s: &str) -> String {
    let out = ENTITY.replace_all(s, |c: &Captures| {
        let name = &c[1];
        if let Some(num) = name.strip_prefix('#') {
            let code = match num.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok(),
                None => num.parse::<u32>().ok(),
            };
            return match code.filter(|&c| c <= 0x10FFFF) {
                Some(c) => char::from_u32(c).unwrap_or('\u{FFFD}').to_string(),
                None => c[0].to_owned(),
            };
        }
        match name.to_lowercase().as_str() {
            "nbsp" => " ".to_owned(),
            "amp" => "&".to_owned(),
            "lt" => "<".to_owned(),
            "gt" => ">".to_owned(),
            "quot" => "\"".to_owned(),
            "apos" => "'".to_owned(),
            _ => c[0].to_owned(),
        }
    });
    out.replace('\u{A0}', " ")
}

static TAG: LazyLock<Regex> = LazyLock::new(|| re(r"<[^>]+>"));

fn cell_text(cell: &str) -> String {
    js::squish(&decode_html(&TAG.replace_all(cell, " ")))
}

static TR_END: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)</tr{WS}*>"));
static TD: LazyLock<Regex> = LazyLock::new(|| re(r"(?is)<td(?-u:\b)[^>]*>(.*?)</td{WS}*>"));

/// Rows of cell texts. Tolerates rows missing their opening `<tr>`.
fn table_rows(fragment: &str) -> Vec<Vec<String>> {
    TR_END
        .split(fragment)
        .map(|chunk| {
            TD.captures_iter(chunk)
                .map(|c| cell_text(&c[1]))
                .collect::<Vec<_>>()
        })
        .filter(|cells| !cells.is_empty())
        .collect()
}

#[derive(Clone, Copy)]
enum Col {
    Course,
    Title,
    Session,
    Units,
    Section,
    Mini,
    Days,
    Begin,
    End,
    Location,
    Mode,
}

fn column(class: &str) -> Option<Col> {
    Some(match class.to_lowercase().as_str() {
        "course" => Col::Course,
        "title" => Col::Title,
        "session" => Col::Session,
        "units" => Col::Units,
        "section" => Col::Section,
        "mini" => Col::Mini,
        "days" => Col::Days,
        "begin" => Col::Begin,
        "end" => Col::End,
        "location" => Col::Location,
        "deliverymode" => Col::Mode,
        _ => return None,
    })
}

static DEPT_SPLIT: LazyLock<Regex> = LazyLock::new(|| re(r#"(?i)<h4 class="department-title">"#));
static THEAD: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)<thead"));
static THEAD_END: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)</thead"));
static TBODY: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)<tbody"));
static TBODY_END: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)</tbody"));
static TH_CLASS: LazyLock<Regex> = LazyLock::new(|| re(r#"(?i)<th[^>]*class="col-([a-zA-Z]+)""#));

/// `s.slice(start, end)` with JavaScript's handling of a missing (-1) index: one character short of the end.
fn js_slice(s: &str, start: Option<usize>, end: Option<usize>) -> &str {
    let minus_one = s.char_indices().last().map_or(0, |(i, _)| i);
    let start = start.unwrap_or(minus_one);
    let end = end.unwrap_or(minus_one);
    if start >= end { "" } else { &s[start..end] }
}

/// Parses a `SOCServlet/search` results page: one table per department.
pub fn parse_search_page(html: &str) -> Vec<SocRow> {
    let mut out = Vec::new();
    for part in DEPT_SPLIT.split(html).skip(1) {
        let department = cell_text(js_slice(part, Some(0), part.find("</h4>")));
        let head = js_slice(
            part,
            THEAD.find(part).map(|m| m.start()),
            THEAD_END.find(part).map(|m| m.start()),
        );
        let columns: Vec<Option<Col>> = TH_CLASS
            .captures_iter(head)
            .map(|c| column(&c[1]))
            .collect();
        let Some(body_start) = TBODY.find(part).map(|m| m.start()) else {
            continue;
        };
        if columns.is_empty() {
            continue;
        }
        let body = &part[body_start..];
        let body = match TBODY_END.find(body) {
            Some(m) => &body[..m.start()],
            None => body,
        };
        for cells in table_rows(body) {
            if cells.len() < columns.len() {
                continue;
            }
            let mut row = SocRow {
                department: department.clone(),
                ..SocRow::default()
            };
            for (col, cell) in columns.iter().zip(cells) {
                let Some(col) = col else { continue };
                *match col {
                    Col::Course => &mut row.course,
                    Col::Title => &mut row.title,
                    Col::Session => &mut row.session,
                    Col::Units => &mut row.units,
                    Col::Section => &mut row.section,
                    Col::Mini => &mut row.mini,
                    Col::Days => &mut row.days,
                    Col::Begin => &mut row.begin,
                    Col::End => &mut row.end,
                    Col::Location => &mut row.location,
                    Col::Mode => &mut row.mode,
                } = cell;
            }
            if !(row.course.len() == 5 && row.course.bytes().all(|b| b.is_ascii_digit())) {
                row.course.clear();
            }
            out.push(row);
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DetailSection {
    pub name: String,
    /// For non-lecture sections listed under a lecture, that lecture's raw label (`Lec 1`).
    pub lecture: Option<String>,
}

static UNITS_TH: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)<th[^>]*>{WS}*Units"));
static TH: LazyLock<Regex> = LazyLock::new(|| re(r"(?is)<th(?-u:\b)[^>]*>(.*?)</th{WS}*>"));

/// Lecture to section grouping from a `SOCServlet/courseDetails` page, where sections are listed under their lecture.
pub fn parse_details_grouping(html: &str) -> Vec<DetailSection> {
    let Some(start) = UNITS_TH.find(html).map(|m| m.start()) else {
        return Vec::new();
    };
    // `lastIndexOf('<table', start)`: `start` is at `<th`, so no match can begin there.
    let table_start = html[..start].rfind("<table").unwrap_or(start);
    let table = js_slice(
        html,
        Some(table_start),
        html[start..].find("</table>").map(|i| start + i),
    );
    let headers: Vec<String> = TH.captures_iter(table).map(|c| cell_text(&c[1])).collect();
    let Some(col) = headers
        .iter()
        .position(|h| h.eq_ignore_ascii_case("sec") || h.eq_ignore_ascii_case("section"))
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut lecture: Option<String> = None;
    for cells in table_rows(table) {
        let Some(name) = cells.get(col).filter(|n| !n.is_empty()) else {
            continue;
        };
        if is_lecture(name) {
            lecture = Some(name.clone());
            out.push(DetailSection {
                name: name.clone(),
                lecture: None,
            });
        } else {
            out.push(DetailSection {
                name: name.clone(),
                lecture: lecture.clone(),
            });
        }
    }
    out
}

/// What a course's detail page adds to the search listing: reservations per section and special permission.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DetailExtras {
    /// Section label to its reservation lines (`Some reservations are for First-Year in M00`), sorted.
    pub reservations: Vec<(String, Vec<String>)>,
    /// `Special Permission Required`; `None` when the page doesn't say.
    pub permission: Option<bool>,
}

static RESERVATIONS: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)<h4[^>]*>{WS}*Reservations{WS}*</h4>"));
static PERMISSION: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)<dt>{WS}*Special Permission Required{WS}*</dt>{WS}*<dd>{WS}*(Yes|No)(?-u:\b)")
});

pub fn parse_details_extras(html: &str) -> DetailExtras {
    let mut reservations: Vec<(String, Vec<String>)> = Vec::new();
    if let Some(heading) = RESERVATIONS.find(html).map(|m| m.start()) {
        let table = match html[heading..].find("</table>") {
            Some(end) => &html[heading..heading + end],
            None => "",
        };
        for cells in table_rows(table) {
            let (Some(section), Some(restriction)) = (cells.first(), cells.get(1)) else {
                continue;
            };
            if section.is_empty()
                || restriction.is_empty()
                || restriction.eq_ignore_ascii_case("none")
            {
                continue;
            }
            let i = match reservations.iter().position(|(s, _)| s == section) {
                Some(i) => i,
                None => {
                    reservations.push((section.clone(), Vec::new()));
                    reservations.len() - 1
                }
            };
            let list = &mut reservations[i].1;
            if !list.contains(restriction) {
                list.push(restriction.clone());
            }
        }
        // The page's order varies between fetches; sorted, unchanged reservations don't show up as changes.
        for (_, list) in &mut reservations {
            list.sort();
        }
    }
    let permission = PERMISSION
        .captures(html)
        .map(|c| c[1].eq_ignore_ascii_case("yes"));
    DetailExtras {
        reservations,
        permission,
    }
}

/// A SOC title cell: `Course Title`, `Course Title : Topic` (first row of a topics course), `: Topic` (later
/// sections), each optionally suffixed with `This Section Cancelled`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SocTitle {
    pub base: String,
    pub topic: Option<String>,
    pub cancelled: bool,
}

static CANCELLED: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i){WS}*(?-u:\b)This Section Cancell?ed$"));

pub fn split_soc_title(raw: &str) -> SocTitle {
    let mut t = js::squish(raw);
    let cancelled = CANCELLED.is_match(&t);
    if cancelled {
        t = js::trim(&CANCELLED.replace(&t, "")).to_owned();
    }
    let nonempty = |s: &str| Some(js::trim(s).to_owned()).filter(|s| !s.is_empty());
    if let Some(rest) = t.strip_prefix(':') {
        return SocTitle {
            base: String::new(),
            topic: nonempty(rest),
            cancelled,
        };
    }
    match t.find(" : ") {
        None => SocTitle {
            base: t,
            topic: None,
            cancelled,
        },
        Some(i) => SocTitle {
            base: js::trim(&t[..i]).to_owned(),
            topic: nonempty(&t[i + 3..]),
            cancelled,
        },
    }
}

/// `Lec 1` is section `1`, a bare `Lec` is `1`, anything else is itself.
pub fn section_name(raw: &str) -> String {
    let t = js::trim(raw);
    match t.strip_prefix("Lec") {
        Some(rest) if !rest.contains(['\n', '\r', '\u{2028}', '\u{2029}']) => {
            let n = js::trim(rest);
            if n.is_empty() {
                "1".to_owned()
            } else {
                n.to_owned()
            }
        }
        _ => t.to_owned(),
    }
}

pub fn is_lecture(raw: &str) -> bool {
    js::trim(raw)
        .strip_prefix("Lec")
        .is_some_and(|rest| !rest.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_'))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

static OPTION: LazyLock<Regex> =
    LazyLock::new(|| re(r#"(?is)<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>"#));

/// Value and label pairs of a `<select name="...">`.
pub fn select_options(html: &str, name: &str) -> Vec<SelectOption> {
    let select = re(&format!(
        r#"(?i)<select[^>]*name="{}""#,
        regex::escape(name)
    ));
    let Some(i) = select.find(html).map(|m| m.start()) else {
        return Vec::new();
    };
    let seg = js_slice(html, Some(i), html[i..].find("</select>").map(|e| i + e));
    OPTION
        .captures_iter(seg)
        .map(|c| SelectOption {
            value: c[1].to_owned(),
            label: cell_text(&c[2]),
        })
        .collect()
}

/// Delivery mode label to the code the schedule CSVs use (IPE, REO, ...); unknown labels pass through.
pub fn mode_code(label: &str) -> String {
    const CODES: [(&str, &str); 7] = [
        ("In-person Expectation", "IPE"),
        ("In-person only", "IPO"),
        ("Remote only", "REO"),
        ("In-person + remote", "IPR"),
        ("In-person (rotation) + remote", "IRR"),
        ("In-person + technology", "IPT"),
        ("In-person Expectation Rotation", "PER"),
    ];
    let t = js::trim(label);
    let lower = t.to_lowercase();
    CODES
        .iter()
        .find(|(k, _)| k.to_lowercase() == lower)
        .map_or_else(|| t.to_owned(), |(_, code)| (*code).to_owned())
}

/// A course detail page as the catalog uses it, cached in `exported/soc/details.json`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocDetail {
    pub semester: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prereq_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coreqs: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cross_listed: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub urls: Option<Vec<String>>,
    /// Absent when the page has no units cell; `Some(None)` for variable units.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "ser_units",
        deserialize_with = "de_units"
    )]
    pub units: Option<Option<f64>>,
}

fn ser_units<S: serde::Serializer>(v: &Option<Option<f64>>, s: S) -> Result<S::Ok, S::Error> {
    ser_opt_num(&v.flatten(), s)
}

fn de_units<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<f64>>, D::Error> {
    Ok(Some(Option::<f64>::deserialize(d)?))
}

/// `exported/soc/details.json`.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocDetailsCache {
    pub fetched_at: String,
    pub courses: std::collections::BTreeMap<String, SocDetail>,
    /// Course ids requested but not found in any semester, skipped on later runs.
    #[serde(default)]
    pub missing: Vec<String>,
}

/// `build-catalog.ts`'s `decodeEntities`: a fixed sequence of replacements.
pub fn decode_entities(s: &str) -> String {
    static NUMERIC: LazyLock<Regex> = LazyLock::new(|| re(r"&#([0-9]+);"));
    let s = s
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");
    NUMERIC
        .replace_all(&s, |c: &Captures| {
            // String.fromCharCode keeps the low 16 bits.
            let n = c[1].parse::<u64>().unwrap_or(u64::MAX) as u16;
            char::from_u32(n as u32).unwrap_or('\u{FFFD}').to_string()
        })
        .into_owned()
}

static BR: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)<br{WS}*/?>"));
static SPACES_TABS: LazyLock<Regex> = LazyLock::new(|| re(r"[ \t]+"));
static AROUND_NEWLINE: LazyLock<Regex> = LazyLock::new(|| re(r"{WS}*\n{WS}*"));

fn strip_tags(s: &str) -> String {
    let s = BR.replace_all(s, "\n");
    let s = TAG.replace_all(&s, " ");
    let s = decode_entities(&s);
    let s = SPACES_TABS.replace_all(&s, " ");
    js::trim(&AROUND_NEWLINE.replace_all(&s, "\n")).to_owned()
}

fn dd_after<'a>(html: &'a str, label: &str) -> Option<&'a str> {
    let pattern = re(&format!(
        r"(?is)<dt>{{WS}}*{label}{{WS}}*</dt>{{WS}}*<dd>(.*?)</dd>"
    ));
    pattern
        .captures(html)
        .map(|c| c.get(1).map_or("", |m| m.as_str()))
}

static NONE_TEXT: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)^{WS}*(none)?{WS}*$"));

fn is_none(s: Option<&str>) -> bool {
    s.is_none_or(|s| NONE_TEXT.is_match(&strip_tags(s)))
}

static MAINTITLE: LazyLock<Regex> =
    LazyLock::new(|| re(r#"data-maintitle="[0-9]{5}(?:&nbsp;|{WS})+([^"]*)""#));
static DESCRIPTION: LazyLock<Regex> =
    LazyLock::new(|| re(r#"(?s)id="course-detail-description".*?<p[^>]*>(.*?)</p>"#));
static TWO_SPACES: LazyLock<Regex> = LazyLock::new(|| re(r"{WS}{2,}"));
static ANY_SPACES: LazyLock<Regex> = LazyLock::new(|| re(r"{WS}+"));
static COURSE_NUMBER: LazyLock<Regex> = LazyLock::new(|| re(r"[0-9]{2}-?[0-9]{3}"));
static URLS: LazyLock<Regex> =
    LazyLock::new(|| re(r#"(?s)id="course-detail-related-urls".*?</dl>"#));
static HREF: LazyLock<Regex> = LazyLock::new(|| re(r#"href="([^"]+)""#));
static UNITS_TD: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)<td>{WS}*([0-9.]+|VAR){WS}*</td>"));

fn to_id(code: &str) -> String {
    code.chars().filter(char::is_ascii_digit).collect()
}

fn course_numbers(s: &str) -> Vec<String> {
    COURSE_NUMBER
        .find_iter(&strip_tags(s))
        .map(|m| to_id(m.as_str()))
        .collect()
}

/// Parses a `SOCServlet/courseDetails` page for the catalog.
pub fn parse_soc_detail(html: &str, semester: &str) -> SocDetail {
    let mut out = SocDetail {
        semester: semester.to_owned(),
        ..SocDetail::default()
    };
    if let Some(c) = MAINTITLE.captures(html) {
        out.title = Some(js::trim(&decode_entities(&c[1])).to_owned());
    }
    if let Some(c) = DESCRIPTION.captures(html) {
        let d = TWO_SPACES.replace_all(&strip_tags(&c[1]), " ").into_owned();
        if !d.is_empty() && !d.eq_ignore_ascii_case("none") {
            out.description = Some(d);
        }
    }
    let pre = dd_after(html, "Prerequisites");
    if !is_none(pre) {
        out.prereq_text = Some(
            ANY_SPACES
                .replace_all(&strip_tags(pre.unwrap()), " ")
                .into_owned(),
        );
    }
    let co = dd_after(html, "Corequisites");
    if !is_none(co) {
        out.coreqs = Some(course_numbers(co.unwrap()));
    }
    let cross = dd_after(html, "Cross-Listed Courses");
    if !is_none(cross) {
        out.cross_listed = Some(course_numbers(cross.unwrap()));
    }
    let notes = dd_after(html, "Notes");
    if !is_none(notes) {
        out.notes = Some(strip_tags(notes.unwrap()).replace('\n', ""));
    }
    if let Some(perm) = dd_after(html, "Special Permission Required").filter(|p| !p.is_empty()) {
        out.permission = Some(strip_tags(perm).to_lowercase().contains("yes"));
    }
    if let Some(m) = URLS.find(html) {
        let list: Vec<String> = HREF
            .captures_iter(m.as_str())
            .map(|c| decode_entities(&c[1]))
            .collect();
        if !list.is_empty() {
            out.urls = Some(list);
        }
    }
    if let Some(c) = UNITS_TD.captures(html) {
        out.units = Some(if c[1].eq_ignore_ascii_case("VAR") {
            None
        } else {
            Some(js::number(&c[1])).filter(|n| !n.is_nan())
        });
    }
    out
}

/// The semester code (`F26`) and course ids of a SOC `.dat` schedule dump.
pub fn parse_dat(text: &str) -> (Option<String>, Vec<String>) {
    static SEMESTER: LazyLock<Regex> =
        LazyLock::new(|| re(r"(?i)Semester:{WS}*(Fall|Spring|Summer){WS}+([0-9]{4})"));
    static ID: LazyLock<Regex> = LazyLock::new(|| re(r"(?m)^\t([0-9]{5})\t"));
    let semester = SEMESTER.captures(text).map(|c| {
        let letter = match c[1].to_lowercase().as_str() {
            "fall" => 'F',
            "spring" => 'S',
            _ => 'M',
        };
        format!("{letter}{}", &c[2][2..])
    });
    let mut ids: Vec<String> = Vec::new();
    for c in ID.captures_iter(text) {
        if !ids.iter().any(|i| i == &c[1]) {
            ids.push(c[1].to_owned());
        }
    }
    (semester, ids)
}

/// Courses listing two or more lectures and some other section: the flat listing can't say which lecture owns which
/// section, so their detail pages are fetched.
pub fn ambiguous_courses(rows: &[SocRow]) -> Vec<String> {
    let mut out = Vec::new();
    let mut course = "";
    let (mut lectures, mut others) = (0, 0);
    for row in rows {
        if !row.course.is_empty() {
            if !course.is_empty() && lectures >= 2 && others > 0 {
                out.push(course.to_owned());
            }
            course = &row.course;
            lectures = 0;
            others = 0;
        }
        if row.section.is_empty() {
            continue;
        }
        if is_lecture(&row.section) {
            lectures += 1;
        } else {
            others += 1;
        }
    }
    if !course.is_empty() && lectures >= 2 && others > 0 {
        out.push(course.to_owned());
    }
    out
}

/// Latin-1 text, as the SOC serves it: each byte is one character.
pub fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

/// A response's text, by the charset its `Content-Type` declares: the SOC's search pages say ISO-8859-1, its detail
/// pages UTF-8. Anything else, or bytes that aren't the UTF-8 they claim, is read as Latin-1.
pub fn response_text(bytes: &[u8], content_type: Option<&str>) -> String {
    let utf8 = content_type.is_some_and(|t| {
        t.split(';').skip(1).any(|p| {
            p.trim()
                .to_ascii_lowercase()
                .strip_prefix("charset=")
                .is_some_and(|c| c.trim_matches('"') == "utf-8")
        })
    });
    match std::str::from_utf8(bytes) {
        Ok(text) if utf8 => text.to_owned(),
        _ => latin1(bytes),
    }
}

/// A stored capture's text. Captures hold each page's decoded text as UTF-8 (Courseweave's captures too); bytes that
/// aren't UTF-8 are read as Latin-1.
pub fn stored_text(bytes: Vec<u8>) -> String {
    String::from_utf8(bytes).unwrap_or_else(|e| latin1(e.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(id: &str) -> String {
        format!(
            r#"<a href="" onclick="openModal('#m', '', '/SOC/SOCServlet/courseDetails?COURSE={id}&SEMESTER=F26'); return false;">{id}</a>"#
        )
    }

    fn head(cols: &[&str]) -> String {
        let ths: String = cols
            .iter()
            .map(|c| format!(r#"<th class="col-{c}">{c}</th>"#))
            .collect();
        format!("<thead><tr>{ths}</tr></thead>")
    }

    fn row(cells: &[&str], open: bool) -> String {
        let tds: String = cells
            .iter()
            .map(|c| format!("<td>\n  {c}\n</td>"))
            .collect();
        format!("{}{tds}</tr>", if open { "<tr>" } else { "" })
    }

    const FALL: [&str; 10] = [
        "course",
        "title",
        "units",
        "section",
        "mini",
        "days",
        "begin",
        "end",
        "location",
        "deliverymode",
    ];

    fn search_page() -> String {
        let pgh = "Pittsburgh, Pennsylvania";
        let ipe = "In-person Expectation";
        format!(
            r#"<h4 class="department-title">COMPUTER SCIENCE</h4>
<table>{}<tbody>
{}
{}
{}
</tbody></table>
<h4 class="department-title">ARTS &amp; ENTERTAINMENT MANAGEMENT</h4>
<table>{}<tbody>
{}
</tbody></table>"#,
            head(&FALL),
            row(
                &[
                    &link("15122"),
                    "Principles of Imperative Computation ",
                    "12",
                    "Lec 1",
                    "",
                    "TR",
                    "09:30AM",
                    "10:50AM",
                    pgh,
                    ipe
                ],
                true
            ),
            row(
                &[
                    "&nbsp;", "", "&nbsp;", "&nbsp;", "", "T", "07:00PM", "08:20PM", pgh, ipe
                ],
                false
            ),
            row(
                &[
                    "&nbsp;", "", "&nbsp;", "A", "", "F", "09:00AM", "09:50AM", pgh, ipe
                ],
                false
            ),
            head(&[
                "course",
                "title",
                "session",
                "units",
                "section",
                "mini",
                "days",
                "begin",
                "end",
                "location",
                "deliverymode"
            ]),
            row(
                &[
                    &link("93430"),
                    "Technologies Transforming the Arts",
                    "summer",
                    "6",
                    "A5",
                    "Y",
                    "TR",
                    "11:00AM",
                    "12:20PM",
                    pgh,
                    "Remote only"
                ],
                true
            ),
        )
    }

    #[test]
    fn reads_every_row_including_continuations() {
        let rows = parse_search_page(&search_page());
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0].department, "COMPUTER SCIENCE");
        assert_eq!(rows[0].course, "15122");
        assert_eq!(rows[0].title, "Principles of Imperative Computation");
        assert_eq!(
            (
                rows[0].units.as_str(),
                rows[0].section.as_str(),
                rows[0].days.as_str()
            ),
            ("12", "Lec 1", "TR")
        );
        assert_eq!(
            (rows[1].course.as_str(), rows[1].section.as_str()),
            ("", "")
        );
        assert_eq!(
            (rows[1].days.as_str(), rows[1].begin.as_str()),
            ("T", "07:00PM")
        );
        assert_eq!(
            (rows[2].section.as_str(), rows[2].days.as_str()),
            ("A", "F")
        );
    }

    #[test]
    fn maps_columns_from_the_header() {
        let rows = parse_search_page(&search_page());
        let r = &rows[3];
        assert_eq!(r.department, "ARTS & ENTERTAINMENT MANAGEMENT");
        assert_eq!(
            (
                r.session.as_str(),
                r.units.as_str(),
                r.section.as_str(),
                r.mini.as_str(),
                r.mode.as_str()
            ),
            ("summer", "6", "A5", "Y", "Remote only")
        );
    }

    #[test]
    fn groups_sections_under_their_lecture() {
        let html = r#"<table><thead><tr><th></th><th>Units</th><th>Section</th><th>Mini</th><th>Days</th></tr></thead><tbody>
      <tr><td></td><td>12.0</td><td>Lec 1</td><td></td><td>TR</td></tr>
      <tr><td></td><td></td><td></td><td></td><td>T</td></tr>
      <tr><td></td><td></td><td>A</td><td></td><td>F</td></tr>
      <tr><td></td><td></td><td>S</td><td></td><td>F</td></tr>
      <tr><td></td><td></td><td>Lec 2</td><td></td><td>TR</td></tr>
      <tr><td></td><td></td><td>J</td><td></td><td>F</td></tr>
    </tbody></table>"#;
        let ds = |name: &str, lecture: Option<&str>| DetailSection {
            name: name.to_owned(),
            lecture: lecture.map(str::to_owned),
        };
        assert_eq!(
            parse_details_grouping(html),
            [
                ds("Lec 1", None),
                ds("A", Some("Lec 1")),
                ds("S", Some("Lec 1")),
                ds("Lec 2", None),
                ds("J", Some("Lec 2")),
            ]
        );
    }

    #[test]
    fn titles_labels_and_modes() {
        let t = |base: &str, topic: Option<&str>, cancelled| SocTitle {
            base: base.to_owned(),
            topic: topic.map(str::to_owned),
            cancelled,
        };
        assert_eq!(
            split_soc_title("Independent Study"),
            t("Independent Study", None, false)
        );
        assert_eq!(
            split_soc_title("New Pedagogies : Unreasonable Architecture This Section Cancelled"),
            t("New Pedagogies", Some("Unreasonable Architecture"), true)
        );
        assert_eq!(
            split_soc_title(": Faculty Research Focus Groups"),
            t("", Some("Faculty Research Focus Groups"), false)
        );
        assert_eq!(
            split_soc_title("Structural Design 2: Materials & Analysis").base,
            "Structural Design 2: Materials & Analysis"
        );
        assert_eq!(section_name("Lec 1"), "1");
        assert_eq!(section_name("Lec"), "1");
        assert_eq!(section_name("A3"), "A3");
        assert!(
            is_lecture("Lec 2") && is_lecture("Lec") && !is_lecture("Lecture") && !is_lecture("A")
        );
        assert_eq!(mode_code("In-Person + Technology"), "IPT");
        assert_eq!(mode_code("Remote only"), "REO");
        assert_eq!(mode_code("Something new"), "Something new");
    }

    const DETAIL: &str = r#"
<div class="col-md-6"><dl><dt>Special Permission Required</dt>
      <dd>No</dd></dl></div>
<div class="row"><div class="col-md-12"><h4>Reservations</h4>
  <table class="table table-condensed">
    <tr><th>Section</th><th>Restriction</th></tr>
    <tr>
        <td>A</td>
        <td>Some reservations are for First-Year

            in M00
        </td>
     </tr>
    <tr><td>B</td><td>Some reservations are for First-Year in M00</td></tr>
    <tr><td>B</td><td>All reservations are for Sophomore in CS</td></tr>
  </table>
</div></div>"#;

    #[test]
    fn reads_reservations_and_permission() {
        let extras = parse_details_extras(DETAIL);
        assert_eq!(
            extras.reservations,
            [
                (
                    "A".to_owned(),
                    vec!["Some reservations are for First-Year in M00".to_owned()]
                ),
                (
                    "B".to_owned(),
                    vec![
                        "All reservations are for Sophomore in CS".to_owned(),
                        "Some reservations are for First-Year in M00".to_owned()
                    ]
                ),
            ]
        );
        assert_eq!(extras.permission, Some(false));
        let none =
            "<dt>Special Permission Required</dt><dd>Yes</dd><h4>Reservations</h4><p>None</p>";
        assert_eq!(
            parse_details_extras(none),
            DetailExtras {
                reservations: vec![],
                permission: Some(true)
            }
        );
        assert_eq!(parse_details_extras(""), DetailExtras::default());
    }

    #[test]
    fn decodes_entities() {
        assert_eq!(
            decode_html("a&nbsp;b &amp; &#65;&#x42;&Uuml;x &bogus;"),
            "a b & AB&Uuml;x &bogus;"
        );
        assert_eq!(decode_entities("&amp;lt; &#8217;"), "< \u{2019}");
    }

    #[test]
    fn parses_course_details() {
        let html = r#"<div id="course-detail-modal-body"><div class="row" data-maintitle="15122&nbsp;&nbsp;Principles of Imperative Computation">
<table><tr><th>Units</th></tr><tr><td> 12.0 </td></tr></table>
<div id="course-detail-description"><h4>Description</h4><p>Pointers &amp;  invariants.<br/>More.</p></div>
<dl><dt>Prerequisites</dt><dd>15112 or 15-151</dd>
<dt>Corequisites</dt><dd>None</dd>
<dt>Cross-Listed Courses</dt><dd>15-122, 15622</dd>
<dt>Notes</dt><dd>  </dd>
<dt>Special Permission Required</dt><dd>No</dd></dl>
<dl id="course-detail-related-urls"><dt>URL</dt><dd><a href="https://www.cs.cmu.edu/~15122/">site</a></dd></dl></div></div>"#;
        let d = parse_soc_detail(html, "F26");
        assert_eq!(
            d.title.as_deref(),
            Some("Principles of Imperative Computation")
        );
        assert_eq!(
            d.description.as_deref(),
            Some("Pointers & invariants.\nMore.")
        );
        assert_eq!(d.prereq_text.as_deref(), Some("15112 or 15-151"));
        assert_eq!(d.coreqs, None);
        assert_eq!(
            d.cross_listed,
            Some(vec!["15122".to_owned(), "15622".to_owned()])
        );
        assert_eq!(d.notes, None);
        assert_eq!(d.permission, Some(false));
        assert_eq!(
            d.urls,
            Some(vec!["https://www.cs.cmu.edu/~15122/".to_owned()])
        );
        assert_eq!(d.units, Some(Some(12.0)));
        let json = serde_json::to_string(&d).unwrap();
        assert!(json.ends_with(r#""units":12}"#), "{json}");
    }

    #[test]
    fn reads_select_options_and_dat_dumps() {
        let html = r#"<select id="s" name="SEMESTER"><option value="F26" selected>Fall 2026</option><option value="S27">Spring
 2027</option></select><select name="DEPT"><option value="CS">Computer Science (15XXX)</option></select>"#;
        let sems = select_options(html, "SEMESTER");
        assert_eq!(sems.len(), 2);
        assert_eq!(
            (sems[1].value.as_str(), sems[1].label.as_str()),
            ("S27", "Spring 2027")
        );
        assert_eq!(
            select_options(html, "DEPT")[0].label,
            "Computer Science (15XXX)"
        );
        let (sem, ids) =
            parse_dat("Semester: Fall 2026 (aa)\n\t15122\tX\n\t \n\t15122\tY\n\t21127\tZ\n");
        assert_eq!(sem.as_deref(), Some("F26"));
        assert_eq!(ids, ["15122", "21127"]);
    }

    #[test]
    fn finds_ambiguous_courses() {
        let r = |course: &str, section: &str| SocRow {
            course: course.to_owned(),
            section: section.to_owned(),
            ..SocRow::default()
        };
        let rows = [
            r("15122", "Lec 1"),
            r("", "Lec 2"),
            r("", "A"),
            r("15150", "Lec 1"),
            r("", "A"),
            r("21127", "Lec 1"),
            r("", "Lec 2"),
        ];
        assert_eq!(ambiguous_courses(&rows), ["15122"]);
    }

    #[test]
    fn decodes_by_the_declared_charset() {
        // A search page (Latin-1) and a detail page (UTF-8).
        assert_eq!(
            response_text(b"Pok\xe9mon\xa0", Some("text/html;charset=ISO-8859-1")),
            "Pok\u{e9}mon\u{a0}"
        );
        let detail = "Today\u{2019}s systems.\u{a0}";
        assert_eq!(
            response_text(detail.as_bytes(), Some("text/html; charset=\"UTF-8\"")),
            detail
        );
        assert_eq!(
            response_text(b"Bj\xf6rk", Some("text/html;charset=UTF-8")),
            "Bj\u{f6}rk"
        );
        assert_eq!(response_text(b"plain", None), "plain");
        // Captures hold that text as UTF-8.
        assert_eq!(stored_text(detail.as_bytes().to_vec()), detail);
        assert_eq!(stored_text(b"Pok\xe9mon".to_vec()), "Pok\u{e9}mon");
    }
}
