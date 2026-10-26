//! A registrar schedule CSV: the primary source for a term the SOC doesn't list yet, then a supplement for its
//! instructors and rooms (Courseweave's `scripts/sources/csv.ts`). Columns:
//! `num,title,units,section,lecture,days,begin,end,bldg,room,mode,level,dept,instructors`, one row per meeting.
//!
//! Options: `path`, relative to the exported root.

use std::collections::HashMap;

use anyhow::{Context, Result};

use super::{Inputs, Loaded};
use crate::js;
use crate::model::{Course, Kind, Meeting, Section, TermMeta, course_code, is_course_id};
use crate::text::{
    add_instructors, clean_title, csv_records, location, mini_of, most_common, parse_days,
    parse_time, split_instructors,
};

pub fn load(
    source: &crate::config::SourceConfig,
    term: &TermMeta,
    inputs: &Inputs,
) -> Result<Loaded> {
    let rel = source
        .str("path")
        .with_context(|| format!("{}: csv source needs a path", term.id))?;
    let path = inputs.exported.join(rel);
    let bytes = std::fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
    Ok(Loaded {
        courses: parse(&String::from_utf8_lossy(&bytes), term),
        fetched_at: None,
    })
}

pub fn parse(text: &str, term: &TermMeta) -> Vec<Course> {
    let records = csv_records(text);
    let field = |r: &HashMap<String, String>, k: &str| r.get(k).cloned().unwrap_or_default();

    let mut order: Vec<String> = Vec::new();
    let mut by_course: HashMap<String, Vec<&HashMap<String, String>>> = HashMap::new();
    for r in &records {
        let num = field(r, "num");
        if !is_course_id(&num) {
            continue;
        }
        by_course
            .entry(num.clone())
            .or_insert_with(|| {
                order.push(num.clone());
                Vec::new()
            })
            .push(r);
    }

    let mut courses = Vec::new();
    for id in order {
        let rows = &by_course[&id];
        let common = |k: &str| most_common(rows.iter().map(|r| field(r, k))).unwrap_or_default();
        let title = clean_title(&common("title"));
        let units = js::number(&common("units"));

        let mut sections: Vec<Section> = Vec::new();
        for r in rows {
            let name = field(r, "section");
            let i = match sections.iter().position(|s| s.name == name) {
                Some(i) => i,
                None => {
                    let section_title = clean_title(&field(r, "title"));
                    let mut section = Section::new(
                        name.clone(),
                        if field(r, "lecture").is_empty() {
                            Kind::Section
                        } else {
                            Kind::Lecture
                        },
                        None,
                        mini_of(&name, term),
                        field(r, "mode"),
                    );
                    if section_title != title {
                        section.title = Some(section_title);
                    }
                    sections.push(section);
                    sections.len() - 1
                }
            };
            let section = &mut sections[i];
            add_instructors(
                &mut section.instructors,
                split_instructors(&field(r, "instructors")),
            );
            section.add_meeting(Meeting {
                days: parse_days(&field(r, "days")),
                start: parse_time(&field(r, "begin")),
                end: parse_time(&field(r, "end")),
                building: location(&field(r, "bldg")),
                room: location(&field(r, "room")),
            });
        }

        courses.push(Course {
            code: course_code(&id),
            title,
            units: (!(units < 0.0 || units.is_nan())).then_some(units),
            dept: common("dept"),
            level: if common("level") == "G" { "G" } else { "U" }.to_owned(),
            instructors: Vec::new(),
            sections,
            cross_listed: Vec::new(),
            permission_required: None,
            pass_fail: None,
            id,
        });
    }
    courses
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MiniMeta;

    pub(crate) fn spring() -> TermMeta {
        TermMeta {
            id: "S27".into(),
            name: "Spring 2027".into(),
            season: "spring".into(),
            year: 2027,
            minis: vec![
                MiniMeta {
                    number: 3,
                    name: "Mini 3".into(),
                    start: "2027-01-19".into(),
                    end: "2027-03-05".into(),
                },
                MiniMeta {
                    number: 4,
                    name: "Mini 4".into(),
                    start: "2027-03-15".into(),
                    end: "2027-04-30".into(),
                },
            ],
            classes_begin: "2027-01-19".into(),
            classes_end: "2027-04-30".into(),
            no_classes: vec![],
            notes: None,
            sources: vec![],
        }
    }

    #[test]
    fn groups_rows_into_sections_and_meetings() {
        let csv =
            "num,title,units,section,lecture,days,begin,end,bldg,room,mode,level,dept,instructors
15122,Imperative Computation,12,1,1,TR,09:30AM,10:50AM,GHC,4401,IPE,U,CS,Cervesato; TBA
15122,Imperative Computation,12,1,1,T,07:00PM,08:20PM,TBA,TBA,IPE,U,CS,
15122,Imperative Computation,12,A3,,F,09:00AM,09:50AM,PH,226C,IPE,U,CS,Kosbie
00080,Study Abroad,-1,A,,TBA,,,TBA,TBA,IPE,U,IED,
x,ignored,,,,,,,,,,,,
";
        let courses = parse(csv, &spring());
        assert_eq!(courses.len(), 2);
        let c = &courses[0];
        assert_eq!(
            (c.id.as_str(), c.code.as_str(), c.units),
            ("15122", "15-122", Some(12.0))
        );
        assert_eq!(c.sections.len(), 2);
        assert_eq!(c.sections[0].kind, Kind::Lecture);
        assert_eq!(c.sections[0].meetings.len(), 2);
        assert_eq!(c.sections[0].instructors, ["Cervesato"]);
        assert_eq!(c.sections[0].meetings[1].building, None);
        assert_eq!(c.sections[1].mini, Some(3));
        assert_eq!(courses[1].units, None);
        assert_eq!(
            serde_json::to_string(&c.sections[1]).unwrap(),
            r#"{"name":"A3","kind":"section","parent":null,"mini":3,"mode":"IPE","instructors":["Kosbie"],"meetings":[{"days":[4],"start":540,"end":590,"building":"PH","room":"226C"}]}"#
        );
    }
}
