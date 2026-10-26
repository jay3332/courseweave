//! Folding a supplement source into the primary course list (Courseweave's `scripts/lib/merge.ts`). Never removes
//! data:
//! - sections missing from the primary (recitations) are added with their parent link, unless `add_missing_sections`
//!   is false
//! - sections in both get missing instructors, rooms, meetings, capacity, reservations and parent filled in; a
//!   section with scheduled meetings gets the supplement's meetings at other times only when `add_missing_meetings`
//!   is set
//! - courses missing from the primary are added only when `add_missing_courses` is set

use std::collections::BTreeMap;

use crate::model::Course;
use crate::text::add_instructors;

pub fn merge_supplement(
    primary: &mut BTreeMap<String, Course>,
    supplement: Vec<Course>,
    add_missing_courses: bool,
    add_missing_sections: bool,
    add_missing_meetings: bool,
) {
    for sup in supplement {
        let Some(course) = primary.get_mut(&sup.id) else {
            if add_missing_courses {
                primary.insert(sup.id.clone(), sup);
            }
            continue;
        };
        if course.units.is_none() && sup.units.is_some() {
            course.units = sup.units;
        }
        if course.permission_required != Some(true) && sup.permission_required == Some(true) {
            course.permission_required = Some(true);
        }
        for s in sup.sections {
            let Some(existing) = course.sections.iter_mut().find(|x| x.name == s.name) else {
                if add_missing_sections {
                    course.sections.push(s);
                }
                continue;
            };
            if existing.instructors.is_empty() {
                add_instructors(&mut existing.instructors, s.instructors.iter().cloned());
            }
            if existing.capacity.is_none() && s.capacity.is_some() {
                existing.capacity = s.capacity;
            }
            if existing.reservations.is_none() && s.reservations.is_some() {
                existing.reservations = s.reservations.clone();
            }
            if existing.parent.is_none() && s.parent.is_some() {
                existing.parent = s.parent.clone();
            }
            if !existing.meetings.iter().any(|m| m.is_scheduled()) {
                existing.meetings = s.meetings;
                continue;
            }
            // Same times, but the primary has no room: take the supplement's.
            for m in &mut existing.meetings {
                if m.building.as_deref().is_some_and(|b| !b.is_empty()) {
                    continue;
                }
                let found = s.meetings.iter().find(|x| {
                    x.start == m.start
                        && x.end == m.end
                        && x.days.iter().any(|d| m.days.contains(d))
                        && x.building.as_deref().is_some_and(|b| !b.is_empty())
                });
                if let Some(found) = found {
                    m.building = found.building.clone();
                    m.room = found.room.clone();
                }
            }
            if !add_missing_meetings {
                continue;
            }
            for m in s.meetings {
                if !existing
                    .meetings
                    .iter()
                    .any(|x| x.start == m.start && x.days == m.days)
                {
                    existing.add_meeting(m);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Kind, Meeting, Section};

    fn meeting(days: &[u8], start: Option<i32>, building: Option<&str>) -> Meeting {
        Meeting {
            days: days.to_vec(),
            start,
            end: start.map(|s| s + 50),
            building: building.map(str::to_owned),
            room: building.map(|_| "100".to_owned()),
        }
    }

    fn section(name: &str, parent: Option<&str>, meetings: Vec<Meeting>) -> Section {
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
        s.meetings = meetings;
        s
    }

    fn course(id: &str, units: Option<f64>, sections: Vec<Section>) -> Course {
        Course {
            id: id.into(),
            code: crate::model::course_code(id),
            title: "T".into(),
            units,
            dept: "CS".into(),
            level: "U".into(),
            instructors: vec![],
            sections,
            cross_listed: vec![],
            permission_required: None,
            pass_fail: None,
        }
    }

    #[test]
    fn fills_gaps_without_removing_anything() {
        let mut primary = BTreeMap::new();
        primary.insert(
            "15122".to_owned(),
            course(
                "15122",
                None,
                vec![section("1", None, vec![meeting(&[1, 3], Some(570), None)])],
            ),
        );
        let mut lecture = section(
            "1",
            None,
            vec![
                meeting(&[1, 3], Some(570), Some("GHC")),
                meeting(&[1], Some(1140), Some("DH")),
            ],
        );
        lecture.instructors = vec!["Cervesato".into()];
        lecture.capacity = Some(244.0);
        let recitation = section("A", Some("1"), vec![meeting(&[4], Some(540), Some("PH"))]);
        merge_supplement(
            &mut primary,
            vec![
                course("15122", Some(12.0), vec![lecture, recitation.clone()]),
                course("99999", Some(1.0), vec![recitation]),
            ],
            false,
            true,
            true,
        );
        assert_eq!(primary.len(), 1);
        let c = &primary["15122"];
        assert_eq!(c.units, Some(12.0));
        assert_eq!(c.sections.len(), 2);
        let l = &c.sections[0];
        assert_eq!(l.instructors, ["Cervesato"]);
        assert_eq!(l.capacity, Some(244.0));
        assert_eq!(l.meetings.len(), 2);
        assert_eq!(l.meetings[0].building.as_deref(), Some("GHC"));
        assert_eq!(c.sections[1].parent.as_deref(), Some("1"));
    }

    #[test]
    fn respects_add_missing_flags() {
        let mut primary = BTreeMap::new();
        primary.insert(
            "15122".to_owned(),
            course("15122", Some(12.0), vec![section("1", None, vec![])]),
        );
        merge_supplement(
            &mut primary,
            vec![
                course("15122", None, vec![section("A", Some("1"), vec![])]),
                course("15150", None, vec![section("1", None, vec![])]),
            ],
            true,
            false,
            false,
        );
        assert_eq!(primary["15122"].sections.len(), 1);
        assert!(primary.contains_key("15150"));
    }

    #[test]
    fn an_authoritative_primary_keeps_its_meeting_times() {
        let mut primary = BTreeMap::new();
        primary.insert(
            "45820".to_owned(),
            course(
                "45820",
                Some(6.0),
                vec![
                    section("A3", None, vec![meeting(&[1, 3], Some(600), None)]),
                    section("B3", None, vec![]),
                ],
            ),
        );
        // The supplement has the room, the old Tuesday and Thursday time, and the same time split by day; for the
        // section the primary lists as TBA, its times.
        merge_supplement(
            &mut primary,
            vec![course(
                "45820",
                None,
                vec![
                    section(
                        "A3",
                        None,
                        vec![
                            meeting(&[1, 3], Some(600), Some("TEP")),
                            meeting(&[2, 4], Some(600), Some("TEP")),
                            meeting(&[1], Some(600), Some("TEP")),
                        ],
                    ),
                    section("B3", None, vec![meeting(&[2], Some(720), Some("TEP"))]),
                ],
            )],
            false,
            false,
            false,
        );
        let c = &primary["45820"];
        assert_eq!(c.sections[0].meetings.len(), 1);
        assert_eq!(c.sections[0].meetings[0].building.as_deref(), Some("TEP"));
        assert_eq!(c.sections[1].meetings.len(), 1);
    }
}
