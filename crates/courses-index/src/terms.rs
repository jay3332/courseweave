//! Semester documents (Courseweave's `scripts/build-data.ts`): `term/<id>` for each term in `data/terms.json`, and
//! from them `terms`, `offerings` and `teaching`.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use anyhow::{Result, bail};
use tracing::info;

use crate::config::TermConfig;
use crate::js::{self, Object};
use crate::merge::merge_supplement;
use crate::model::{
    Course, Offering, OfferingsData, Section, Teaching, TeachingData, TeachingTerm, TermData,
    TermIndexEntry,
};
use crate::sources::{self, Inputs};
use crate::text::add_instructors;

/// Lectures first in source order, each followed by its child sections; children of a missing parent are top-level.
fn order_sections(mut sections: Vec<Section>) -> Vec<Section> {
    let names: HashSet<String> = sections.iter().map(|s| s.name.clone()).collect();
    for s in &mut sections {
        if s.parent.as_ref().is_some_and(|p| !names.contains(p)) {
            s.parent = None;
        }
    }
    let mut out = Vec::with_capacity(sections.len());
    for top in sections.iter().filter(|s| s.parent.is_none()) {
        out.push(top.clone());
        out.extend(
            sections
                .iter()
                .filter(|s| s.parent.as_deref() == Some(&top.name))
                .cloned(),
        );
    }
    out
}

/// Courses with a top-level section meeting at exactly the same times in the same real room.
fn detect_cross_listings(courses: &mut [Course]) {
    let mut by_signature: Vec<(String, Vec<usize>)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for (ci, c) in courses.iter().enumerate() {
        for s in &c.sections {
            if s.parent.is_some() {
                continue;
            }
            let located: Vec<_> = s
                .meetings
                .iter()
                .filter(|m| {
                    !m.days.is_empty()
                        && m.start.is_some()
                        && m.building.as_deref().is_some_and(|b| !b.is_empty())
                        && m.room.as_deref().is_some_and(|r| !r.is_empty())
                })
                .collect();
            if located.is_empty() || located.len() != s.meetings.len() {
                continue;
            }
            let mut keys: Vec<String> = located.iter().map(|m| m.key()).collect();
            keys.sort();
            let mini = s.mini.map_or_else(|| "null".to_owned(), |m| m.to_string());
            let sig = format!("{mini}#{}", keys.join(";"));
            let i = *index.entry(sig.clone()).or_insert_with(|| {
                by_signature.push((sig, Vec::new()));
                by_signature.len() - 1
            });
            let ids = &mut by_signature[i].1;
            if !ids.contains(&ci) {
                ids.push(ci);
            }
        }
    }
    let mut add: Vec<(usize, String)> = Vec::new();
    for (_, ids) in &by_signature {
        if ids.len() < 2 || ids.len() > 6 {
            continue;
        }
        for &a in ids {
            for &b in ids {
                let (course, other) = (&courses[a], &courses[b]);
                let shares = course.instructors.is_empty()
                    || course
                        .instructors
                        .iter()
                        .any(|n| other.instructors.contains(n));
                if a != b && shares {
                    add.push((a, other.id.clone()));
                }
            }
        }
    }
    for (a, id) in add {
        if !courses[a].cross_listed.contains(&id) {
            courses[a].cross_listed.push(id);
        }
    }
    for c in courses.iter_mut() {
        c.cross_listed.sort();
    }
}

/// A built term, before pass/fail flags from the catalog are applied.
pub struct BuiltTerm {
    pub data: TermData,
    /// The newest fetch time among the term's sources, when they record one.
    pub fetched_at: Option<String>,
}

pub fn build_term(config: &TermConfig, inputs: &Inputs) -> Result<BuiltTerm> {
    let term = config.meta();
    let mut merged: BTreeMap<String, Course> = BTreeMap::new();
    let mut fetched_at: Option<String> = None;
    for (i, source) in config.sources.iter().enumerate() {
        let loaded = sources::load(source, &term, inputs)?;
        let count = loaded.courses.len();
        if let Some(f) = loaded.fetched_at
            && fetched_at.as_ref().is_none_or(|g| f > *g)
        {
            fetched_at = Some(f);
        }
        let role = source
            .role
            .as_deref()
            .unwrap_or(if i == 0 { "primary" } else { "supplement" });
        if role == "primary" {
            if i != 0 {
                bail!("{}: only the first source can be primary", term.id);
            }
            for c in loaded.courses {
                merged.insert(c.id.clone(), c);
            }
        } else {
            let add_sections = source.add_missing_sections != Some(false);
            merge_supplement(
                &mut merged,
                loaded.courses,
                source.add_missing_courses == Some(true),
                add_sections,
                source.add_missing_meetings.unwrap_or(add_sections),
            );
        }
        info!(term = %term.id, source = %source.kind, role, courses = count, "source");
    }

    let mut courses: Vec<Course> = merged.into_values().collect();
    for c in &mut courses {
        c.sections = order_sections(std::mem::take(&mut c.sections));
        let mut instructors = Vec::new();
        for s in &c.sections {
            add_instructors(&mut instructors, s.instructors.iter().cloned());
        }
        c.instructors = instructors;
        c.cross_listed.clear();
    }
    detect_cross_listings(&mut courses);

    // Flag thin data instead of silently showing blanks.
    let mut notes = config.notes.clone().unwrap_or_default();
    let sections: Vec<&Section> = courses.iter().flat_map(|c| &c.sections).collect();
    let with_instructors = sections
        .iter()
        .filter(|s| !s.instructors.is_empty())
        .count();
    if !sections.is_empty() && (with_instructors as f64) / (sections.len() as f64) < 0.05 {
        notes.push("Instructors and rooms aren't listed for this term.".to_owned());
    }
    if sections
        .iter()
        .any(|s| s.kind == crate::model::Kind::Lecture)
        && !sections.iter().any(|s| s.parent.is_some())
    {
        notes.push(
            "Recitation and lab sections aren't available for this term yet; only lectures and standalone sections are listed."
                .to_owned(),
        );
    }
    let mut meta = term;
    meta.notes = (!notes.is_empty()).then_some(notes);
    Ok(BuiltTerm {
        data: TermData {
            term: meta,
            generated_at: String::new(),
            courses,
        },
        fetched_at,
    })
}

/// Marks the courses graded pass/fail only.
pub fn apply_pass_fail(term: &mut TermData, pass_fail: &BTreeSet<String>) {
    for c in &mut term.courses {
        c.pass_fail = pass_fail.contains(&c.id).then_some(true);
    }
}

/// Whether `name` teaches `section`. Recitations often repeat their lecture's instructors, so a recitation only counts
/// when the person isn't on its lecture.
pub fn teaches_section(course: &Course, section: &Section, name: &str) -> bool {
    if !section.instructors.iter().any(|n| n == name) {
        return false;
    }
    let Some(parent) = &section.parent else {
        return true;
    };
    !course
        .sections
        .iter()
        .find(|s| &s.name == parent)
        .is_some_and(|p| p.instructors.iter().any(|n| n == name))
}

fn season_order(season: &str) -> i64 {
    match season {
        "spring" => 0,
        "summer" => 1,
        _ => 2,
    }
}

/// The term index, newest first.
pub fn term_index(terms: &[TermData]) -> Vec<TermIndexEntry> {
    let mut index: Vec<TermIndexEntry> = terms
        .iter()
        .map(|t| TermIndexEntry {
            term: t.term.clone(),
            course_count: t.courses.len(),
            section_count: t.section_count(),
        })
        .collect();
    index.sort_by(|a, b| {
        b.term
            .year
            .cmp(&a.term.year)
            .then(season_order(&b.term.season).cmp(&season_order(&a.term.season)))
    });
    index
}

/// Which terms offer each course, newest first, titled from the newest. `terms` is in `data/terms.json` order.
pub fn offerings(terms: &[TermData], order: &[String]) -> OfferingsData {
    struct Offered {
        dept: String,
        level: String,
        titles: HashMap<String, String>,
    }
    let mut offered: BTreeMap<String, Offered> = BTreeMap::new();
    for t in terms {
        for c in &t.courses {
            let o = offered.entry(c.id.clone()).or_insert_with(|| Offered {
                dept: c.dept.clone(),
                level: c.level.clone(),
                titles: HashMap::new(),
            });
            o.titles.insert(t.term.id.clone(), c.title.clone());
        }
    }
    let mut courses = Object::new();
    for (id, o) in offered {
        let terms: Vec<String> = order
            .iter()
            .filter(|t| o.titles.contains_key(*t))
            .cloned()
            .collect();
        courses.push(
            id,
            Offering {
                title: o.titles[&terms[0]].clone(),
                dept: o.dept,
                level: o.level,
                terms,
            },
        );
    }
    OfferingsData {
        terms: order.to_vec(),
        courses,
    }
}

/// Who teaches what in each term. `terms` is in `data/terms.json` order.
pub fn teaching(terms: &[TermData], order: &[String]) -> TeachingData {
    #[derive(Default)]
    struct Taught {
        depts: HashMap<String, usize>,
        terms: HashMap<String, (BTreeSet<String>, usize)>,
    }
    let mut teaching: HashMap<String, Taught> = HashMap::new();
    for t in terms {
        for c in &t.courses {
            for section in &c.sections {
                for name in &section.instructors {
                    if !teaches_section(c, section, name) {
                        continue;
                    }
                    let taught = teaching.entry(name.clone()).or_default();
                    *taught.depts.entry(c.dept.clone()).or_default() += 1;
                    let in_term = taught.terms.entry(t.term.id.clone()).or_default();
                    in_term.0.insert(c.id.clone());
                    in_term.1 += 1;
                }
            }
        }
    }
    let mut names: Vec<String> = teaching.keys().cloned().collect();
    names.sort_by(|a, b| js::locale_cmp(a, b).then_with(|| a.cmp(b)));
    let mut instructors = Object::new();
    for name in names {
        let taught = &teaching[&name];
        let mut depts: Vec<(&String, &usize)> = taught.depts.iter().collect();
        depts.sort_by(|a, b| {
            b.1.cmp(a.1)
                .then_with(|| js::locale_cmp(a.0, b.0))
                .then_with(|| a.0.cmp(b.0))
        });
        let mut by_term = Object::new();
        for id in order {
            if let Some((courses, sections)) = taught.terms.get(id) {
                by_term.push(
                    id.clone(),
                    TeachingTerm {
                        courses: courses.iter().cloned().collect(),
                        sections: *sections,
                    },
                );
            }
        }
        instructors.push(
            name,
            Teaching {
                depts: depts.into_iter().map(|(d, _)| d.clone()).collect(),
                terms: by_term,
            },
        );
    }
    TeachingData {
        terms: order.to_vec(),
        instructors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Kind, Meeting};

    fn section(
        name: &str,
        parent: Option<&str>,
        instructors: &[&str],
        meetings: Vec<Meeting>,
    ) -> Section {
        let mut s = Section::new(
            name.into(),
            if parent.is_some() {
                Kind::Section
            } else {
                Kind::Lecture
            },
            parent.map(str::to_owned),
            None,
            "IPE".into(),
        );
        s.instructors = instructors.iter().map(|s| s.to_string()).collect();
        s.meetings = meetings;
        s
    }

    fn course(id: &str, instructors: &[&str], sections: Vec<Section>) -> Course {
        Course {
            id: id.into(),
            code: crate::model::course_code(id),
            title: id.into(),
            units: Some(12.0),
            dept: "CS".into(),
            level: "U".into(),
            instructors: instructors.iter().map(|s| s.to_string()).collect(),
            sections,
            cross_listed: vec![],
            permission_required: None,
            pass_fail: None,
        }
    }

    fn located() -> Meeting {
        Meeting {
            days: vec![1, 3],
            start: Some(570),
            end: Some(650),
            building: Some("GHC".into()),
            room: Some("4401".into()),
        }
    }

    #[test]
    fn orders_lectures_before_their_children() {
        let ordered = order_sections(vec![
            section("A", Some("1"), &[], vec![]),
            section("1", None, &[], vec![]),
            section("B", Some("9"), &[], vec![]),
            section("2", None, &[], vec![]),
        ]);
        let names: Vec<_> = ordered
            .iter()
            .map(|s| (s.name.as_str(), s.parent.as_deref()))
            .collect();
        assert_eq!(
            names,
            [("1", None), ("A", Some("1")), ("B", None), ("2", None)]
        );
    }

    #[test]
    fn cross_lists_courses_meeting_together() {
        let mut courses = vec![
            course(
                "15122",
                &["Kosbie"],
                vec![section("1", None, &["Kosbie"], vec![located()])],
            ),
            course(
                "15622",
                &["Kosbie"],
                vec![section("1", None, &["Kosbie"], vec![located()])],
            ),
            course(
                "15999",
                &["Someone"],
                vec![section("1", None, &["Someone"], vec![located()])],
            ),
        ];
        detect_cross_listings(&mut courses);
        assert_eq!(courses[0].cross_listed, ["15622"]);
        assert_eq!(courses[1].cross_listed, ["15122"]);
        assert!(courses[2].cross_listed.is_empty());
    }

    #[test]
    fn recitations_only_count_for_new_instructors() {
        let c = course(
            "15122",
            &[],
            vec![
                section("1", None, &["Kosbie"], vec![]),
                section("A", Some("1"), &["Kosbie", "TA"], vec![]),
            ],
        );
        assert!(teaches_section(&c, &c.sections[0], "Kosbie"));
        assert!(!teaches_section(&c, &c.sections[1], "Kosbie"));
        assert!(teaches_section(&c, &c.sections[1], "TA"));
    }
}
