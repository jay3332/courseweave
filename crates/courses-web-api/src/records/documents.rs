//! One-per-student records: the academic record (Courseweave's persisted `state/record.ts`) and preferences. A
//! student without one reads the defaults at revision 0; a write at revision 0 creates it.

use std::collections::BTreeMap;

use axum::{Extension, Json};
use rusqlite::{Connection, OptionalExtension, named_params};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use utoipa::ToSchema;

use super::{
    COUNT_WRITE, DAILY_WRITES, UNDER_CAP, WriteState, check, check_text, check_units, is_course_id,
    is_record_id, is_term, schedules::SCHEDULES_MAX, to_stored, write_failed,
};
use crate::{
    auth::{CurrentUser, Writer},
    db::{now_ms, utc_day},
    error::{ApiError, ApiResult, ErrorBody, ErrorCode},
    state::AppState,
};

fn is_false(b: &bool) -> bool {
    !*b
}

/// The data of a one-per-student record, as stored.
pub trait Document: Serialize + DeserializeOwned + Default + Send + 'static {
    const KIND: &'static str;
    fn validate(&self) -> ApiResult<()>;
}

/// The stored data with its revision and last write time; the defaults at revision 0 when there is none.
pub fn read<D: Document>(db: &Connection, owner: &str) -> ApiResult<(D, WriteState, i64)> {
    let row = db
        .query_row(
            "SELECT body, revision, day, day_writes, updated_at FROM user_documents WHERE owner = ? AND kind = ?",
            [owner, D::KIND],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    WriteState {
                        revision: r.get(1)?,
                        day: r.get(2)?,
                        day_writes: r.get(3)?,
                    },
                    r.get::<_, i64>(4)?,
                ))
            },
        )
        .optional()?;
    Ok(match row {
        Some((body, state, updated)) => (serde_json::from_str(&body)?, state, updated),
        None => (
            D::default(),
            WriteState {
                revision: 0,
                day: 0,
                day_writes: 0,
            },
            0,
        ),
    })
}

/// Writes `data` over revision `base`, returning the new revision and write time.
fn write<D: Document, V: Serialize>(
    db: &Connection,
    owner: &str,
    data: &D,
    base: i64,
    view: impl FnOnce(D, i64, i64) -> V,
) -> ApiResult<(i64, i64)> {
    let body = to_stored(data)?;
    let now = now_ms();
    let today = utc_day(now);
    let changed = if base == 0 {
        db.execute(
            "INSERT INTO user_documents(owner, kind, body, revision, updated_at, day, day_writes)
             VALUES (?, ?, ?, 1, ?, ?, 1) ON CONFLICT(owner, kind) DO NOTHING",
            rusqlite::params![owner, D::KIND, body, now, today],
        )?
    } else {
        db.execute(
            &format!(
                "UPDATE user_documents SET body = :body, revision = revision + 1, updated_at = :now, {COUNT_WRITE}
                 WHERE owner = :owner AND kind = :kind AND revision = :base AND {UNDER_CAP}"
            ),
            named_params! {
                ":body": body,
                ":now": now,
                ":today": today,
                ":owner": owner,
                ":kind": D::KIND,
                ":base": base,
                ":cap": DAILY_WRITES,
            },
        )?
    };
    if changed == 1 {
        return Ok((base + 1, now));
    }
    let (current, state, updated) = read::<D>(db, owner)?;
    let revision = state.revision;
    // A missing document conflicts as revision 0 rather than 404, so the client can create it.
    let state = if revision == 0 { None } else { Some(state) };
    let current = serde_json::to_value(view(current, revision, updated))?;
    Err(match state {
        None => {
            let mut e = ApiError::conflict(());
            e.current = Some(current);
            e
        }
        Some(state) => write_failed(Some(state), base, || Ok(current)),
    })
}

// ---------------------------------------------------------------------------------------------------------------
// The academic record

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum RecordSource {
    /// Taken at CMU.
    Taken,
    /// Credit from another institution.
    Transfer,
    /// AP, IB or A-Level credit.
    Exam,
    /// Placed out without credit.
    Waiver,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ExamCredit {
    pub id: String,
    pub score: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecordEntry {
    pub id: String,
    /// Five-digit course id; null for transfer credit with no CMU equivalent.
    #[serde(default)]
    #[schema(required = true)]
    pub course_id: Option<String>,
    pub source: RecordSource,
    /// Term taken, such as `F25`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub term: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grade: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exam: Option<ExamCredit>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub institution: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Milliseconds since the epoch.
    pub added_at: i64,
}

/// A requisite waiver for one course.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StoredOverride {
    #[serde(default, skip_serializing_if = "is_false")]
    pub prereqs: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub coreqs: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub antireqs: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub updated_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Undergraduate,
    Graduate,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StudentProfile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_term: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_graduation: Option<String>,
    /// A college code, such as `SCS`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub college: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub majors: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minors: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<Level>,
}

/// Courseweave's `RecordData`.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordData {
    #[serde(default)]
    pub entries: Vec<RecordEntry>,
    #[serde(default)]
    pub overrides: BTreeMap<String, StoredOverride>,
    #[serde(default)]
    pub profile: StudentProfile,
}

const ENTRIES_MAX: usize = 600;

impl Document for RecordData {
    const KIND: &'static str = "record";

    fn validate(&self) -> ApiResult<()> {
        check(
            self.entries.len() <= ENTRIES_MAX,
            format!("Records hold at most {ENTRIES_MAX} entries."),
        )?;
        for e in &self.entries {
            check(
                is_record_id(&e.id),
                "Entry ids are 1 to 64 letters, digits, - or _.",
            )?;
            check(
                e.course_id.as_deref().is_none_or(is_course_id),
                "courseId must be a course id like 15122, or null.",
            )?;
            check(
                e.term.as_deref().is_none_or(is_term),
                "Terms look like F25.",
            )?;
            check_text("grade", e.grade.as_deref(), 8)?;
            check_units(e.units)?;
            if let Some(exam) = &e.exam {
                check_text("exam.id", Some(&exam.id), 64)?;
                check_text("exam.score", Some(&exam.score), 16)?;
            }
            check_text("institution", e.institution.as_deref(), 200)?;
            check_text("label", e.label.as_deref(), 200)?;
            check_text("note", e.note.as_deref(), 1000)?;
            check(e.added_at >= 0, "addedAt is milliseconds since the epoch.")?;
        }
        check(self.overrides.len() <= ENTRIES_MAX, "Too many overrides.")?;
        for (course, o) in &self.overrides {
            check(is_course_id(course), "Overrides are keyed by course id.")?;
            check_text("note", o.note.as_deref(), 1000)?;
        }
        let p = &self.profile;
        for term in [&p.entry_term, &p.expected_graduation]
            .into_iter()
            .flatten()
        {
            check(is_term(term), "Terms look like F25.")?;
        }
        check_text("college", p.college.as_deref(), 16)?;
        for list in [&p.majors, &p.minors].into_iter().flatten() {
            check(list.len() <= 10, "At most 10 majors or minors.")?;
            for item in list {
                check_text("majors and minors", Some(item), 200)?;
            }
        }
        Ok(())
    }
}

/// The academic record.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub entries: Vec<RecordEntry>,
    /// Course id to its requisite waivers.
    pub overrides: BTreeMap<String, StoredOverride>,
    pub profile: StudentProfile,
    /// 0 when nothing has been saved yet.
    pub revision: i64,
    pub updated_at: i64,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecordUpdate {
    #[serde(default)]
    pub entries: Vec<RecordEntry>,
    #[serde(default)]
    pub overrides: BTreeMap<String, StoredOverride>,
    #[serde(default)]
    pub profile: StudentProfile,
    /// The revision this change is based on; 0 to create.
    pub revision: i64,
}

/// 409 body for the record.
#[derive(Serialize, ToSchema)]
pub struct RecordConflict {
    pub code: ErrorCode,
    pub message: String,
    pub current: Record,
}

fn record_view(d: RecordData, revision: i64, updated_at: i64) -> Record {
    Record {
        entries: d.entries,
        overrides: d.overrides,
        profile: d.profile,
        revision,
        updated_at,
    }
}

/// The caller's academic record.
#[utoipa::path(
    get,
    path = "/api/record",
    tag = "record",
    responses((status = OK, body = Record), (status = UNAUTHORIZED, body = ErrorBody))
)]
pub async fn get_record(
    user: CurrentUser,
    Extension(state): Extension<AppState>,
) -> ApiResult<Json<Record>> {
    state
        .db
        .run(move |db| {
            let (data, write, updated) = read::<RecordData>(db, &user.subject)?;
            Ok(Json(record_view(data, write.revision, updated)))
        })
        .await
}

/// Replaces the academic record. A stale `revision` gets 409 with the current record.
#[utoipa::path(
    put,
    path = "/api/record",
    tag = "record",
    request_body = RecordUpdate,
    responses(
        (status = OK, body = Record),
        (status = BAD_REQUEST, body = ErrorBody),
        (status = CONFLICT, body = RecordConflict),
        (status = PAYLOAD_TOO_LARGE, body = ErrorBody),
        (status = TOO_MANY_REQUESTS, body = ErrorBody),
    )
)]
pub async fn put_record(
    Writer(user): Writer,
    Extension(state): Extension<AppState>,
    Json(update): Json<RecordUpdate>,
) -> ApiResult<Json<Record>> {
    let data = RecordData {
        entries: update.entries,
        overrides: update.overrides,
        profile: update.profile,
    };
    data.validate()?;
    state
        .db
        .run(move |db| {
            let (revision, updated) =
                write(db, &user.subject, &data, update.revision, record_view)?;
            Ok(Json(record_view(data, revision, updated)))
        })
        .await
}

// ---------------------------------------------------------------------------------------------------------------
// Preferences

/// What calendar blocks show besides the course code.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct CalendarDisplay {
    pub section: bool,
    pub time: bool,
    pub location: bool,
    /// The course's name (or a topics section's title), when the block is tall enough. Off unless chosen.
    #[serde(default)]
    #[schema(required = true)]
    pub title: bool,
}

impl Default for CalendarDisplay {
    fn default() -> Self {
        Self {
            section: true,
            time: true,
            location: true,
            title: false,
        }
    }
}

/// How the schedule page picks a course's sections: dropdowns of every option, or compact buttons to hover through.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SectionPicker {
    #[default]
    Dropdown,
    Compact,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum PlanLayout {
    #[default]
    Cards,
    Table,
}

/// The first-run prompt to add the academic record.
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Onboarding {
    /// The student added their record or skipped the prompt.
    #[serde(default)]
    #[schema(required = true)]
    pub asked: bool,
    /// The "add your record" nudges were closed.
    #[serde(default)]
    #[schema(required = true)]
    pub prompt_hidden: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesData {
    #[serde(default)]
    pub calendar_display: CalendarDisplay,
    #[serde(default)]
    pub active_schedule: BTreeMap<String, String>,
    #[serde(default)]
    pub schedule_order: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub active_plan_id: Option<String>,
    #[serde(default)]
    pub plan_layout: PlanLayout,
    #[serde(default)]
    pub section_picker: SectionPicker,
    #[serde(default)]
    pub onboarding: Onboarding,
}

impl Document for PreferencesData {
    const KIND: &'static str = "preferences";

    fn validate(&self) -> ApiResult<()> {
        check(
            self.active_schedule.len() <= 100,
            "Too many active schedules.",
        )?;
        for (term, id) in &self.active_schedule {
            check(is_term(term), "activeSchedule is keyed by term, like S27.")?;
            check(is_record_id(id), "activeSchedule values are schedule ids.")?;
        }
        check(
            self.schedule_order.len() <= 100,
            "Too many schedule orders.",
        )?;
        for (term, ids) in &self.schedule_order {
            check(is_term(term), "scheduleOrder is keyed by term, like S27.")?;
            check(
                i64::try_from(ids.len()).is_ok_and(|n| n <= SCHEDULES_MAX),
                "Too many schedules in an order.",
            )?;
            check(
                ids.iter().all(|id| is_record_id(id)),
                "scheduleOrder lists schedule ids.",
            )?;
        }
        check(
            self.active_plan_id.as_deref().is_none_or(is_record_id),
            "activePlanId is a plan id or null.",
        )
    }
}

/// Preferences that follow the student between devices.
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub calendar_display: CalendarDisplay,
    /// Term id to the schedule shown for it.
    pub active_schedule: BTreeMap<String, String>,
    /// Term id to the order of its schedules' tabs, by id. Schedules it doesn't list follow, oldest first.
    pub schedule_order: BTreeMap<String, Vec<String>>,
    #[schema(required = true)]
    pub active_plan_id: Option<String>,
    pub plan_layout: PlanLayout,
    pub section_picker: SectionPicker,
    pub onboarding: Onboarding,
    /// 0 when nothing has been saved yet.
    pub revision: i64,
    pub updated_at: i64,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreferencesUpdate {
    #[serde(default)]
    pub calendar_display: CalendarDisplay,
    #[serde(default)]
    pub active_schedule: BTreeMap<String, String>,
    #[serde(default)]
    pub schedule_order: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub active_plan_id: Option<String>,
    #[serde(default)]
    pub plan_layout: PlanLayout,
    #[serde(default)]
    pub section_picker: SectionPicker,
    #[serde(default)]
    pub onboarding: Onboarding,
    /// The revision this change is based on; 0 to create.
    pub revision: i64,
}

/// 409 body for preferences.
#[derive(Serialize, ToSchema)]
pub struct PreferencesConflict {
    pub code: ErrorCode,
    pub message: String,
    pub current: Preferences,
}

fn preferences_view(d: PreferencesData, revision: i64, updated_at: i64) -> Preferences {
    Preferences {
        calendar_display: d.calendar_display,
        active_schedule: d.active_schedule,
        schedule_order: d.schedule_order,
        active_plan_id: d.active_plan_id,
        plan_layout: d.plan_layout,
        section_picker: d.section_picker,
        onboarding: d.onboarding,
        revision,
        updated_at,
    }
}

/// The caller's preferences.
#[utoipa::path(
    get,
    path = "/api/preferences",
    tag = "preferences",
    responses((status = OK, body = Preferences), (status = UNAUTHORIZED, body = ErrorBody))
)]
pub async fn get_preferences(
    user: CurrentUser,
    Extension(state): Extension<AppState>,
) -> ApiResult<Json<Preferences>> {
    state
        .db
        .run(move |db| {
            let (data, write, updated) = read::<PreferencesData>(db, &user.subject)?;
            Ok(Json(preferences_view(data, write.revision, updated)))
        })
        .await
}

/// Replaces the preferences. A stale `revision` gets 409 with the current preferences.
#[utoipa::path(
    put,
    path = "/api/preferences",
    tag = "preferences",
    request_body = PreferencesUpdate,
    responses(
        (status = OK, body = Preferences),
        (status = BAD_REQUEST, body = ErrorBody),
        (status = CONFLICT, body = PreferencesConflict),
        (status = TOO_MANY_REQUESTS, body = ErrorBody),
    )
)]
pub async fn put_preferences(
    Writer(user): Writer,
    Extension(state): Extension<AppState>,
    Json(update): Json<PreferencesUpdate>,
) -> ApiResult<Json<Preferences>> {
    let data = PreferencesData {
        calendar_display: update.calendar_display,
        active_schedule: update.active_schedule,
        schedule_order: update.schedule_order,
        active_plan_id: update.active_plan_id,
        plan_layout: update.plan_layout,
        section_picker: update.section_picker,
        onboarding: update.onboarding,
    };
    data.validate()?;
    state
        .db
        .run(move |db| {
            let (revision, updated) =
                write(db, &user.subject, &data, update.revision, preferences_view)?;
            Ok(Json(preferences_view(data, revision, updated)))
        })
        .await
}
