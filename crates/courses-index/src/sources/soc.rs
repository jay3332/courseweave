//! CMU's public Schedule of Classes, captured by `courses-scraper --mode soc` in `exported/soc/<term>/`
//! (Courseweave's `scripts/sources/soc.ts`).
//!
//! Options: `term` (the SOC's term code; default the term's id) and `campuses` (keep sections at campuses whose name
//! starts with one of these, case-insensitively; default `["Pittsburgh"]`, `["*"]` for all).
//!
//! The public SOC has no instructors or rooms; a supplement source (Stellic) adds them. Cancelled sections are
//! dropped, with the children of a cancelled lecture. Sections listed under a lecture are its children; when a course
//! lists several lectures before its sections, its detail page (in `details.json.gz`) gives the real grouping.

use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::{Result, bail};
use serde::Deserialize;
use serde_json::Value;

use super::{Inputs, Loaded, read_gzip, read_json};
use crate::config::SourceConfig;
use crate::js;
use crate::model::{Course, Kind, Meeting, Section, TermMeta, course_code};
use crate::soc::{
    SocRow, is_lecture, mode_code, parse_details_grouping, parse_search_page, section_name,
    split_soc_title, stored_text,
};
use crate::text::{clean_title, mini_of, parse_days, parse_time};

#[derive(Deserialize)]
struct Meta {
    #[serde(default)]
    departments: Vec<DeptMeta>,
    #[serde(rename = "fetchedAt", default)]
    fetched_at: Option<String>,
}

#[derive(Deserialize)]
struct DeptMeta {
    code: String,
    name: String,
    prefix: Option<String>,
}

#[derive(Deserialize, Default)]
struct Extras {
    #[serde(default)]
    reservations: Option<BTreeMap<String, Vec<String>>>,
    #[serde(default)]
    permission: Option<Value>,
}

fn normalize_dept(name: &str) -> String {
    let upper = name.to_uppercase();
    let mut out = String::new();
    let mut gap = false;
    for c in upper.chars() {
        if c.is_ascii_uppercase() || c.is_ascii_digit() {
            out.push(c);
            gap = false;
        } else if !gap {
            out.push(' ');
            gap = true;
        }
    }
    js::trim(&out).to_owned()
}

struct Departments {
    by_name: HashMap<String, String>,
    by_prefix: HashMap<String, String>,
}

impl Departments {
    fn new(departments: &[DeptMeta]) -> Self {
        let by_name = departments
            .iter()
            .map(|d| (normalize_dept(&d.name), d.code.clone()))
            .collect();
        let mut by_prefix = HashMap::new();
        for d in departments {
            if let Some(p) = d.prefix.as_ref().filter(|p| !p.is_empty()) {
                by_prefix.entry(p.clone()).or_insert_with(|| d.code.clone());
            }
        }
        // 62xxx is shared by several BXA-style codes; the schedule CSVs file them under CFA.
        by_prefix.insert("62".to_owned(), "CFA".to_owned());
        Self { by_name, by_prefix }
    }

    fn code(&self, title: &str, course_id: &str) -> String {
        self.by_name
            .get(&normalize_dept(title))
            .or_else(|| self.by_prefix.get(&course_id[..2]))
            .cloned()
            .unwrap_or_else(|| title.to_owned())
    }
}

/// `VAR`, `3-12`, `9,12` are variable (`None`); `12`, `4.5` are numbers.
fn parse_units(s: &str) -> Option<f64> {
    let t = js::trim(s);
    let (int, frac) = t.split_once('.').unwrap_or((t, "0"));
    let digits = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit());
    (digits(int) && digits(frac)).then(|| js::number(t))
}

struct RawSection<'a> {
    raw: String,
    rows: Vec<&'a SocRow>,
}

struct RawCourse<'a> {
    id: String,
    title: String,
    units: String,
    department: String,
    sections: Vec<RawSection<'a>>,
}

pub fn load(source: &SourceConfig, term: &TermMeta, inputs: &Inputs) -> Result<Loaded> {
    let code = source.str("term").unwrap_or(&term.id).to_owned();
    let dir = inputs.exported.join("soc").join(&code);
    if !dir.join("search-U.html.gz").exists() {
        bail!(
            "{code}: no SOC capture in {}. Run: courses-scraper --mode soc --soc-terms {code}",
            dir.display()
        );
    }
    let campuses: Vec<String> = match source.options.get("campuses") {
        Some(Value::Array(list)) => list
            .iter()
            .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_owned))
            .collect(),
        _ => vec!["Pittsburgh".to_owned()],
    };
    let keep_campus = |location: &str| {
        let loc = location.to_lowercase();
        campuses
            .iter()
            .any(|c| c == "*" || loc.starts_with(&c.to_lowercase()))
    };

    let meta: Meta = read_json(&dir.join("meta.json"))?;
    let departments = Departments::new(&meta.departments);
    let details_path = dir.join("details.json.gz");
    let details: HashMap<String, String> = if details_path.exists() {
        serde_json::from_slice(&read_gzip(&details_path)?)?
    } else {
        HashMap::new()
    };
    let extras_path = dir.join("extras.json");
    let extras: HashMap<String, Extras> = if extras_path.exists() {
        read_json(&extras_path)?
    } else {
        HashMap::new()
    };

    let (u, g) = rayon::join(
        || read_gzip(&dir.join("search-U.html.gz")).map(|b| parse_search_page(&stored_text(b))),
        || read_gzip(&dir.join("search-G.html.gz")).map(|b| parse_search_page(&stored_text(b))),
    );
    let mut courses = Vec::new();
    for (level, rows) in [("U", u?), ("G", g?)] {
        let mut current: Option<RawCourse> = None;
        for row in &rows {
            if !row.course.is_empty() {
                if let Some(raw) = current.take() {
                    courses.extend(build_course(
                        raw,
                        level,
                        term,
                        &departments,
                        &details,
                        &extras,
                        &keep_campus,
                    ));
                }
                current = Some(RawCourse {
                    id: row.course.clone(),
                    title: clean_title(&split_soc_title(&row.title).base),
                    units: row.units.clone(),
                    department: row.department.clone(),
                    sections: Vec::new(),
                });
            }
            let Some(course) = current.as_mut() else {
                continue;
            };
            if !row.section.is_empty() {
                course.sections.push(RawSection {
                    raw: row.section.clone(),
                    rows: vec![row],
                });
            } else if let Some(last) = course.sections.last_mut() {
                last.rows.push(row);
            }
        }
        if let Some(raw) = current.take() {
            courses.extend(build_course(
                raw,
                level,
                term,
                &departments,
                &details,
                &extras,
                &keep_campus,
            ));
        }
    }
    Ok(Loaded {
        courses,
        fetched_at: meta.fetched_at,
    })
}

fn build_course(
    raw: RawCourse,
    level: &str,
    term: &TermMeta,
    departments: &Departments,
    details: &HashMap<String, String>,
    extras: &HashMap<String, Extras>,
    keep_campus: &dyn Fn(&str) -> bool,
) -> Option<Course> {
    // Parent lecture of each raw section label.
    let mut parent_of: HashMap<String, Option<String>> = HashMap::new();
    if let Some(html) = details.get(&raw.id) {
        for g in parse_details_grouping(html) {
            parent_of.insert(g.name, g.lecture);
        }
    }
    let mut last_lecture: Option<String> = None;
    for s in &raw.sections {
        if is_lecture(&s.raw) {
            last_lecture = Some(s.raw.clone());
            parent_of.insert(s.raw.clone(), None);
        } else if !parent_of.contains_key(&s.raw) {
            parent_of.insert(s.raw.clone(), last_lecture.clone());
        }
    }

    let course_extras = extras.get(&raw.id);
    let mut reservations: HashMap<String, Vec<String>> = HashMap::new();
    if let Some(r) = course_extras.and_then(|e| e.reservations.as_ref()) {
        for (label, lines) in r {
            reservations.insert(section_name(label), lines.clone());
        }
    }

    let mut sections: Vec<Section> = Vec::new();
    let mut cancelled: HashSet<String> = HashSet::new();
    for s in &raw.sections {
        let first = s.rows[0];
        let name = section_name(&s.raw);
        let parent_raw = parent_of.get(&s.raw).cloned().flatten();
        let title = split_soc_title(&first.title);
        if title.cancelled
            || parent_raw
                .as_ref()
                .is_some_and(|p| cancelled.contains(&section_name(p)))
        {
            cancelled.insert(name);
            continue;
        }
        if !keep_campus(&first.location) {
            continue;
        }
        let topic = title.topic.as_deref().map(clean_title).unwrap_or_default();
        let mut section = Section::new(
            name.clone(),
            if is_lecture(&s.raw) {
                Kind::Lecture
            } else {
                Kind::Section
            },
            parent_raw.as_deref().map(section_name),
            if first.mini == "Y" {
                mini_of(&name, term)
            } else {
                None
            },
            mode_code(&first.mode),
        );
        if !topic.is_empty() && topic != raw.title {
            section.title = Some(topic);
        }
        if let Some(lines) = reservations.get(&name).filter(|l| !l.is_empty()) {
            section.reservations = Some(lines.clone());
        }
        for r in &s.rows {
            if !keep_campus(&r.location) {
                continue;
            }
            section.add_meeting(Meeting {
                days: parse_days(&r.days),
                start: parse_time(&r.begin),
                end: parse_time(&r.end),
                building: None,
                room: None,
            });
        }
        // Drop placeholder TBA meetings when the section also has real ones.
        if section.meetings.len() > 1 && section.meetings.iter().any(Meeting::is_scheduled) {
            section.meetings.retain(Meeting::is_scheduled);
        }
        sections.push(section);
    }
    // A child whose lecture was filtered out (another campus) is top-level here.
    let names: HashSet<String> = sections.iter().map(|s| s.name.clone()).collect();
    for s in &mut sections {
        if s.parent.as_ref().is_some_and(|p| !names.contains(p)) {
            s.parent = None;
        }
    }
    if sections.is_empty() {
        return None;
    }

    let permission = course_extras
        .and_then(|e| e.permission.as_ref())
        .is_some_and(truthy);
    Some(Course {
        code: course_code(&raw.id),
        title: raw.title,
        units: parse_units(&raw.units),
        dept: departments.code(&raw.department, &raw.id),
        level: level.to_owned(),
        instructors: Vec::new(),
        sections,
        cross_listed: Vec::new(),
        permission_required: permission.then_some(true),
        pass_fail: None,
        id: raw.id,
    })
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn units_and_departments() {
        assert_eq!(parse_units("12"), Some(12.0));
        assert_eq!(parse_units("4.5"), Some(4.5));
        assert_eq!(parse_units("VAR"), None);
        assert_eq!(parse_units("3-12"), None);
        assert_eq!(parse_units("9,12"), None);
        assert_eq!(parse_units("12."), None);
        let depts = Departments::new(&[
            DeptMeta {
                code: "CS".into(),
                name: "Computer Science".into(),
                prefix: Some("15".into()),
            },
            DeptMeta {
                code: "AEM".into(),
                name: "Arts & Entertainment Management".into(),
                prefix: Some("93".into()),
            },
        ]);
        assert_eq!(depts.code("COMPUTER SCIENCE", "15122"), "CS");
        assert_eq!(
            depts.code("ARTS & ENTERTAINMENT MANAGEMENT", "93430"),
            "AEM"
        );
        assert_eq!(depts.code("SOMETHING ELSE", "15999"), "CS");
        assert_eq!(depts.code("BXA", "62100"), "CFA");
        assert_eq!(depts.code("NEW DEPT", "77100"), "NEW DEPT");
    }
}
