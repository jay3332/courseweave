//! Accounts carried over from Courseweave (this instance only; see `deploy/README.md`).
//!
//! Courseweave knew its accounts by email and never kept Google's subject, which is the owner key here. So each
//! account waits in `account_imports` under its email, already in this app's record formats, until that member first
//! signs in. It then moves to their subject in one transaction, unless they already have records here: those are
//! left alone, and so is the staged copy.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::{
    auth::CurrentUser,
    db::{UserDb, now_ms},
    error::ApiResult,
    records::{
        check_name,
        documents::{Document, PreferencesData, RecordData},
        is_course_id, is_record_id, is_term,
        plans::{PlanTerm, ProgramSelection},
        schedules::{self, ScheduleEntry},
    },
};

/// Filled by the import script (`deploy/import-courseweave.py`).
pub const TABLE: &str = "CREATE TABLE IF NOT EXISTS account_imports(
  email TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  staged_at INTEGER NOT NULL
)";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Staged {
    #[serde(default)]
    schedules: Vec<StagedSchedule>,
    #[serde(default)]
    plans: Vec<StagedPlan>,
    #[serde(default)]
    record: Option<RecordData>,
    #[serde(default)]
    preferences: Option<PreferencesData>,
    #[serde(default)]
    saved: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagedSchedule {
    id: String,
    term_id: String,
    name: String,
    entries: Vec<ScheduleEntry>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagedPlan {
    id: String,
    name: String,
    programs: Vec<ProgramSelection>,
    start_term: String,
    terms: Vec<PlanTerm>,
    created_at: i64,
    updated_at: i64,
}

/// `user_plans.body`, as `records::plans` stores it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanBody<'a> {
    name: String,
    programs: &'a [ProgramSelection],
    start_term: &'a str,
    terms: &'a [PlanTerm],
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// Nothing is staged for this email.
    None,
    /// The member already has records here, so the staged account stays where it is.
    Kept,
    Moved {
        schedules: usize,
        plans: usize,
        skipped: usize,
    },
}

/// Moves the account staged for `user`'s email to them.
pub fn claim(db: &mut Connection, user: &CurrentUser) -> ApiResult<Outcome> {
    let tx = db.transaction()?;
    tx.execute_batch(TABLE)?;
    let Some(payload) = tx
        .query_row(
            "SELECT payload FROM account_imports WHERE email = ?",
            [&user.email],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    else {
        return Ok(Outcome::None);
    };
    let owner = &user.subject;
    let has_records: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM user_schedules WHERE owner = ?1)
             OR EXISTS(SELECT 1 FROM user_plans WHERE owner = ?1)
             OR EXISTS(SELECT 1 FROM user_documents WHERE owner = ?1)
             OR EXISTS(SELECT 1 FROM user_saved WHERE owner = ?1)",
        [owner],
        |r| r.get(0),
    )?;
    if has_records {
        return Ok(Outcome::Kept);
    }

    let staged: Staged = serde_json::from_str(&payload)?;
    let now = now_ms();
    let mut skipped = 0;
    let mut schedules = 0;
    for s in staged.schedules {
        let (Ok(name), true, true) = (
            check_name(&s.name),
            is_record_id(&s.id),
            is_term(&s.term_id),
        ) else {
            skipped += 1;
            continue;
        };
        let body = serde_json::to_string(&schedules::Body {
            name,
            entries: s.entries,
        })?;
        schedules += tx.execute(
            "INSERT OR IGNORE INTO user_schedules(owner, id, term_id, body, revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)",
            params![owner, s.id, s.term_id, body, s.created_at, s.updated_at],
        )?;
    }
    let mut plans = 0;
    for p in staged.plans {
        let (Ok(name), true, true) = (
            check_name(&p.name),
            is_record_id(&p.id),
            is_term(&p.start_term),
        ) else {
            skipped += 1;
            continue;
        };
        let body = serde_json::to_string(&PlanBody {
            name,
            programs: &p.programs,
            start_term: &p.start_term,
            terms: &p.terms,
        })?;
        plans += tx.execute(
            "INSERT OR IGNORE INTO user_plans(owner, id, body, revision, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)",
            params![owner, p.id, body, p.created_at, p.updated_at],
        )?;
    }
    if let Some(record) = staged.record {
        skipped += usize::from(!document(&tx, owner, &record, now)?);
    }
    if let Some(preferences) = staged.preferences {
        skipped += usize::from(!document(&tx, owner, &preferences, now)?);
    }
    for course_id in staged.saved.iter().filter(|c| is_course_id(c)) {
        tx.execute(
            "INSERT OR IGNORE INTO user_saved(owner, course_id, saved_at) VALUES (?, ?, ?)",
            params![owner, course_id, now],
        )?;
    }
    tx.execute("DELETE FROM account_imports WHERE email = ?", [&user.email])?;
    tx.commit()?;
    Ok(Outcome::Moved {
        schedules,
        plans,
        skipped,
    })
}

/// Stores a valid document; false when it doesn't validate.
fn document<D: Document>(tx: &Connection, owner: &str, doc: &D, now: i64) -> ApiResult<bool> {
    if doc.validate().is_err() {
        return Ok(false);
    }
    tx.execute(
        "INSERT OR IGNORE INTO user_documents(owner, kind, body, revision, updated_at) VALUES (?, ?, ?, 1, ?)",
        params![owner, D::KIND, serde_json::to_string(doc)?, now],
    )?;
    Ok(true)
}

/// Runs [`claim`] at sign-in. A failure is logged and never stops the sign-in.
pub async fn claim_at_sign_in(db: &UserDb, user: &CurrentUser) {
    let user = user.clone();
    match db.run(move |db| claim(db, &user)).await {
        Ok(Outcome::None) => {}
        Ok(Outcome::Kept) => {
            tracing::info!(
                "a Courseweave account is staged, but this member already has records here"
            )
        }
        Ok(Outcome::Moved {
            schedules,
            plans,
            skipped,
        }) => tracing::info!(
            schedules,
            plans,
            skipped,
            "moved a Courseweave account over"
        ),
        Err(e) => tracing::warn!(error = ?e, "moving a Courseweave account over failed"),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{auth::member, records::documents};

    fn user(subject: &str, andrew: &str) -> CurrentUser {
        member(
            subject.into(),
            Some(&format!("{andrew}@andrew.cmu.edu")),
            true,
            None,
            vec![],
        )
        .unwrap()
    }

    fn stage(db: &Connection, email: &str, payload: serde_json::Value) {
        db.execute_batch(TABLE).unwrap();
        db.execute(
            "INSERT INTO account_imports(email, payload, staged_at) VALUES (?, ?, 0)",
            params![email, payload.to_string()],
        )
        .unwrap();
    }

    #[test]
    fn staged_accounts_move_once_and_never_over_existing_records() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("users.sqlite");
        drop(UserDb::open(&path).unwrap());
        let mut conn = Connection::open(&path).unwrap();

        assert_eq!(
            claim(&mut conn, &user("g-1", "ada")).unwrap(),
            Outcome::None
        );

        stage(
            &conn,
            "ada@andrew.cmu.edu",
            json!({
                "schedules": [
                    {"id": "s1", "termId": "S27", "name": " Main ", "createdAt": 5, "updatedAt": 6, "entries": [
                        {"courseId": "15122", "section": "1", "child": "A", "passFail": false, "color": 0, "hidden": false}
                    ]},
                    {"id": "bad id", "termId": "S27", "name": "x", "createdAt": 0, "updatedAt": 0, "entries": []}
                ],
                "plans": [{"id": "p1", "name": "Four years", "programs": [{"catalogId": 1, "auditId": 2}],
                    "startTerm": "F25", "createdAt": 1, "updatedAt": 2,
                    "terms": [{"term": "F25", "courses": [{"id": "c1", "courseId": "15122"}], "link": {"scheduleId": "s1"}}]}],
                "record": {"entries": [{"id": "e1", "courseId": "15112", "source": "taken", "term": "F25", "addedAt": 1}],
                    "overrides": {}, "profile": {"entryTerm": "F25"}},
                "preferences": {"activeSchedule": {"S27": "s1"}, "activePlanId": "p1", "onboarding": {"asked": true}},
                "saved": ["15122", "nope"]
            }),
        );
        stage(&conn, "bob@andrew.cmu.edu", json!({"saved": ["21127"]}));

        let ada = user("g-1", "ada");
        assert_eq!(
            claim(&mut conn, &ada).unwrap(),
            Outcome::Moved {
                schedules: 1,
                plans: 1,
                skipped: 1
            }
        );
        let listed = schedules::list(&conn, "g-1", None, false).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Main");
        assert_eq!(listed[0].entries[0].child.as_deref(), Some("A"));
        let plan: serde_json::Value = serde_json::from_str(
            &conn
                .query_row("SELECT body FROM user_plans WHERE owner = 'g-1'", [], |r| {
                    r.get::<_, String>(0)
                })
                .unwrap(),
        )
        .unwrap();
        assert_eq!(plan["startTerm"], "F25");
        assert_eq!(plan["terms"][0]["link"]["scheduleId"], "s1");
        let (record, _, _) = documents::read::<RecordData>(&conn, "g-1").unwrap();
        assert_eq!(record.entries[0].course_id.as_deref(), Some("15112"));
        let (prefs, _, _) = documents::read::<PreferencesData>(&conn, "g-1").unwrap();
        assert_eq!(prefs.active_plan_id.as_deref(), Some("p1"));
        assert!(prefs.onboarding.asked);
        let saved: i64 = conn
            .query_row(
                "SELECT count(*) FROM user_saved WHERE owner = 'g-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(saved, 1);
        // Moved, so a second sign-in finds nothing.
        assert_eq!(claim(&mut conn, &ada).unwrap(), Outcome::None);

        // Bob already has records here: his staged account stays put and his records are untouched.
        conn.execute(
            "INSERT INTO user_saved(owner, course_id, saved_at) VALUES ('g-2', '15445', 0)",
            [],
        )
        .unwrap();
        assert_eq!(
            claim(&mut conn, &user("g-2", "bob")).unwrap(),
            Outcome::Kept
        );
        let bob: Vec<String> = conn
            .prepare("SELECT course_id FROM user_saved WHERE owner = 'g-2'")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(bob, ["15445"]);
        let still_staged: i64 = conn
            .query_row("SELECT count(*) FROM account_imports", [], |r| r.get(0))
            .unwrap();
        assert_eq!(still_staged, 1);
    }
}
