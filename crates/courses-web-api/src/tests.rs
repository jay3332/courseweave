//! Router-level tests: requests go through the same layers as in production, with `x-test-user` naming the caller.

use std::{path::Path, time::Duration};

use axum::{
    Router,
    body::{Body, Bytes},
    http::{HeaderMap, Request, StatusCode, header},
};
use courses_catalog::{Audience, CourseRow, MeetingRow, OfferingRow, SectionRow, TermRow, Writer};
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::{
    app::{self, SignIn},
    auth::AuthMode,
    catalog::Catalog,
    db::UserDb,
    ratelimit::Limiter,
    seo::Site,
    state::{AppState, Inner},
    syllabi::SyllabusStore,
};

const ORIGIN: &str = "https://courses.test";
const TEMPLATE: &str = "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <title>CMU Courses</title>\n  </head>\n  <body data-sveltekit-preload-data=\"hover\">\n    <div style=\"display: contents\"></div>\n  </body>\n</html>\n";

fn course(
    id: &'static str,
    code: &'static str,
    title: &'static str,
    description: Option<&'static str>,
) -> CourseRow<'static> {
    CourseRow {
        id,
        code,
        title,
        department: Some("Computer Science"),
        units: Some(12.0),
        units_max: None,
        description,
        prerequisites: Some("15-112"),
        corequisites: None,
    }
}

fn build_catalog(path: &Path) {
    let w = Writer::create(path).unwrap();
    w.put_public("terms", &json!([{"id": "S27"}, {"id": "F26"}]))
        .unwrap();
    w.put_split(
        "term/S27",
        &json!({"sections": [{"room": null}]}),
        &json!({"sections": [{"room": "GHC 4401"}]}),
    )
    .unwrap();
    w.put_member("fce/summary", &json!({"15122": 4.5})).unwrap();
    w.put_raw(
        "big",
        Audience::Public,
        &serde_json::to_vec(&json!({"x": "y".repeat(5000)})).unwrap(),
    )
    .unwrap();
    for (position, (id, name, season, year)) in [
        ("S27", "Spring 2027", "spring", 2027),
        ("F26", "Fall 2026", "fall", 2026),
    ]
    .into_iter()
    .enumerate()
    {
        w.insert_term(&TermRow {
            id,
            name,
            season,
            year,
            position: position as i64,
        })
        .unwrap();
    }
    w.insert_course(&course(
        "15122",
        "15-122",
        "Principles of Imperative Computation",
        Some("Pointers, invariants and <careful> reasoning."),
    ))
    .unwrap();
    w.insert_course(&course(
        "15112",
        "15-112",
        "Fundamentals of Programming",
        Some("Python."),
    ))
    .unwrap();
    w.insert_course(&CourseRow {
        department: Some("Mathematical Sciences"),
        units: Some(9.0),
        ..course("21127", "21-127", "Concepts of Mathematics", None)
    })
    .unwrap();
    w.insert_course(&course(
        "15445",
        "15-445",
        "Database Systems",
        Some("Storage and queries."),
    ))
    .unwrap();
    w.insert_course(&course("99999", "99-999", "99-999", None))
        .unwrap();
    for (course_id, term_id) in [
        ("15122", "S27"),
        ("15122", "F26"),
        ("21127", "S27"),
        ("15445", "F26"),
    ] {
        w.insert_offering(&OfferingRow {
            course_id,
            term_id,
            title: "t",
            department: None,
            units: Some(12.0),
        })
        .unwrap();
    }
    for (course_id, name, kind, parent) in [
        ("15122", "1", "lecture", None),
        ("15122", "2", "lecture", None),
        ("15122", "A", "section", Some("1")),
        ("15122", "B", "section", Some("2")),
        ("21127", "A", "section", None),
    ] {
        w.insert_section(&SectionRow {
            term_id: "S27",
            course_id,
            name,
            kind,
            parent,
            mini: None,
        })
        .unwrap();
    }
    w.insert_meeting(&MeetingRow {
        term_id: "S27",
        course_id: "15122",
        section: "1",
        position: 0,
        days: "024",
        start: Some(600),
        end: Some(680),
    })
    .unwrap();
    w.finish().unwrap();
}

struct Fixture {
    app: Router,
    state: AppState,
    _dir: tempfile::TempDir,
}

struct Options {
    writes_per_minute: u32,
    site: bool,
    syllabi: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            writes_per_minute: 10_000,
            site: true,
            syllabi: true,
        }
    }
}

fn fixture_with(options: Options) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let catalog_path = dir.path().join("catalog.sqlite");
    build_catalog(&catalog_path);
    let syllabi = dir.path().join("syllabi/F25/CS");
    std::fs::create_dir_all(&syllabi).unwrap();
    std::fs::write(syllabi.join("15122-1.pdf"), b"%PDF-1.4 test").unwrap();
    std::fs::write(syllabi.join("15122 notes.docx"), b"docx bytes").unwrap();
    let state = AppState::new(Inner {
        catalog: Catalog::open(&catalog_path).unwrap(),
        db: UserDb::open(&dir.path().join("users.sqlite")).unwrap(),
        origin: ORIGIN.into(),
        admin_group: "/admins".into(),
        auth: AuthMode::Test,
        syllabi: options
            .syllabi
            .then(|| SyllabusStore::Dir(dir.path().join("syllabi"))),
        site: options.site.then(|| Site::from_template(TEMPLATE)),
        writes: Limiter::new(options.writes_per_minute, Duration::from_secs(60)),
    });
    Fixture {
        app: app::router(state.clone(), SignIn::Local),
        state,
        _dir: dir,
    }
}

fn fixture() -> Fixture {
    fixture_with(Options::default())
}

struct Reply {
    status: StatusCode,
    headers: HeaderMap,
    bytes: Bytes,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.bytes)
            .unwrap_or_else(|_| panic!("not JSON: {:?}", String::from_utf8_lossy(&self.bytes)))
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).into_owned()
    }

    fn header(&self, name: header::HeaderName) -> &str {
        self.headers
            .get(name)
            .map(|v| v.to_str().unwrap())
            .unwrap_or("")
    }

    fn code(&self) -> String {
        self.json()["code"].as_str().unwrap_or_default().to_owned()
    }
}

impl Fixture {
    async fn send(&self, request: Request<Body>) -> Reply {
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        Reply {
            status,
            headers,
            bytes,
        }
    }

    fn request(method: &str, uri: &str, user: Option<&str>) -> axum::http::request::Builder {
        let mut req = Request::builder().method(method).uri(uri);
        if let Some(user) = user {
            req = req.header("x-test-user", user);
        }
        if method != "GET" && method != "HEAD" {
            req = req.header(header::ORIGIN, ORIGIN);
        }
        req
    }

    async fn get(&self, uri: &str, user: Option<&str>) -> Reply {
        self.send(Self::request("GET", uri, user).body(Body::empty()).unwrap())
            .await
    }

    async fn write(&self, method: &str, uri: &str, user: &str, body: Option<Value>) -> Reply {
        let req = Self::request(method, uri, Some(user));
        let req = match body {
            Some(body) => req
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string())),
            None => req.body(Body::empty()),
        };
        self.send(req.unwrap()).await
    }
}

fn schedule_body() -> Value {
    json!({"termId": "S27", "name": "Plan A", "entries": [
        {"courseId": "15122", "section": "1", "child": "A", "passFail": false, "color": 0, "hidden": false},
        {"courseId": "21127", "section": "A", "child": null, "passFail": true, "color": 1, "hidden": true}
    ]})
}

#[tokio::test]
async fn health_and_identity() {
    let f = fixture();
    let health = f.get("/api/health", None).await;
    assert_eq!(health.status, StatusCode::OK);
    assert_eq!(
        health.json()["catalogSchema"],
        courses_catalog::SCHEMA_VERSION.to_string()
    );

    let anon = f.get("/api/me", None).await;
    assert_eq!(anon.status, StatusCode::UNAUTHORIZED);
    assert_eq!(anon.code(), "auth");
    let outsider = f.get("/api/me", Some("mallory@gmail.com")).await;
    assert_eq!(outsider.status, StatusCode::FORBIDDEN);
    assert_eq!(outsider.code(), "forbidden");
    let me = f.get("/api/me", Some("alice")).await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(
        me.json(),
        json!({"subject": "alice", "name": "alice", "andrewId": "alice", "email": "alice@andrew.cmu.edu", "isAdmin": false})
    );
    // The session is tagged with its owner, for account deletion.
    let owners: Vec<String> = f
        .state
        .db
        .run(|db| {
            let mut stmt = db.prepare("SELECT owner FROM sessions")?;
            let rows = stmt.query_map([], |r| r.get(0))?;
            Ok(rows.collect::<Result<_, _>>()?)
        })
        .await
        .unwrap();
    assert_eq!(owners, vec!["alice"]);
    assert!(
        me.header(header::SET_COOKIE)
            .starts_with("cmu_courses_session=")
    );
    assert_eq!(me.header(header::X_CONTENT_TYPE_OPTIONS), "nosniff");
    assert_eq!(me.header(header::CACHE_CONTROL), "no-store");
}

#[tokio::test]
async fn catalog_documents_pick_audiences_and_revalidate() {
    let f = fixture();
    let gz = |uri: &str, user: Option<&str>| {
        Fixture::request("GET", uri, user)
            .header(header::ACCEPT_ENCODING, "gzip, br")
            .body(Body::empty())
            .unwrap()
    };
    let public = f.send(gz("/api/catalog/term/S27", None)).await;
    assert_eq!(public.status, StatusCode::OK);
    assert_eq!(public.header(header::CONTENT_ENCODING), "gzip");
    assert_eq!(public.header(header::CACHE_CONTROL), "private, no-cache");
    assert!(public.header(header::VARY).contains("Cookie"));
    let body: Value =
        serde_json::from_slice(&courses_catalog::gunzip(&public.bytes).unwrap()).unwrap();
    assert_eq!(body, json!({"sections": [{"room": null}]}));

    let member = f.get("/api/catalog/term/S27", Some("alice")).await;
    assert_eq!(member.status, StatusCode::OK);
    assert_eq!(
        member.header(header::CONTENT_ENCODING),
        "",
        "identity without Accept-Encoding"
    );
    assert_eq!(member.json(), json!({"sections": [{"room": "GHC 4401"}]}));
    assert_ne!(member.header(header::ETAG), public.header(header::ETAG));

    // A non-CMU account gets the public version.
    let outsider = f
        .get("/api/catalog/term/S27", Some("mallory@gmail.com"))
        .await;
    assert_eq!(outsider.json(), json!({"sections": [{"room": null}]}));

    let locked = f.get("/api/catalog/fce/summary", None).await;
    assert_eq!(
        (locked.status, locked.code().as_str()),
        (StatusCode::UNAUTHORIZED, "auth")
    );
    assert_eq!(
        f.get("/api/catalog/fce/summary", Some("mallory@gmail.com"))
            .await
            .status,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        f.get("/api/catalog/fce/summary", Some("alice"))
            .await
            .json(),
        json!({"15122": 4.5})
    );
    let missing = f.get("/api/catalog/nope", Some("alice")).await;
    assert_eq!(
        (missing.status, missing.code().as_str()),
        (StatusCode::NOT_FOUND, "not_found")
    );
    assert_eq!(
        f.get("/api/catalog/../etc/passwd", None).await.status,
        StatusCode::NOT_FOUND
    );

    let etag = public.header(header::ETAG).to_owned();
    let again = f
        .send(
            Fixture::request("GET", "/api/catalog/term/S27", None)
                .header(header::IF_NONE_MATCH, &etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(again.status, StatusCode::NOT_MODIFIED);
    assert!(again.bytes.is_empty());
    assert_eq!(again.header(header::ETAG), etag);
    // The member version doesn't match the public ETag.
    let member_again = f
        .send(
            Fixture::request("GET", "/api/catalog/term/S27", Some("alice"))
                .header(header::IF_NONE_MATCH, &etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(member_again.status, StatusCode::OK);
    let big = f.get("/api/catalog/big", None).await;
    assert_eq!(big.json()["x"].as_str().unwrap().len(), 5000);
}

#[tokio::test]
async fn public_course_api() {
    let f = fixture();
    let terms = f.get("/api/terms", None).await.json();
    assert_eq!(
        terms[0],
        json!({"id": "S27", "name": "Spring 2027", "season": "spring", "year": 2027})
    );
    assert_eq!(terms.as_array().unwrap().len(), 2);

    let ids = |v: Value| -> Vec<String> {
        v["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        ids(f.get("/api/courses?search=invariants", None).await.json()),
        vec!["15122"]
    );
    assert_eq!(
        ids(f
            .get("/api/courses?search=imperative%20princ", None)
            .await
            .json()),
        vec!["15122"]
    );
    assert_eq!(
        ids(f.get("/api/courses?search=15-1", None).await.json()),
        vec!["15112", "15122"]
    );
    assert_eq!(
        ids(f.get("/api/courses?search=15445", None).await.json()),
        vec!["15445"]
    );
    assert_eq!(
        ids(f.get("/api/courses?term=S27", None).await.json()),
        vec!["15122", "21127"]
    );
    assert_eq!(
        ids(f.get("/api/courses?level=400", None).await.json()),
        vec!["15445"]
    );
    assert_eq!(
        ids(f.get("/api/courses?units=9", None).await.json()),
        vec!["21127"]
    );
    assert_eq!(
        ids(f
            .get("/api/courses?department=mathematical%20sciences", None)
            .await
            .json()),
        vec!["21127"]
    );
    assert_eq!(
        ids(f.get("/api/courses?department=21", None).await.json()),
        vec!["21127"]
    );
    let page = f.get("/api/courses?page=2&pageSize=2", None).await.json();
    assert_eq!(
        (
            page["total"].as_i64(),
            page["page"].as_i64(),
            page["pageSize"].as_i64()
        ),
        (Some(5), Some(2), Some(2))
    );
    assert_eq!(ids(page), vec!["15445", "21127"]);
    let bad = f.get("/api/courses?pageSize=1000", None).await;
    assert_eq!(
        (bad.status, bad.code().as_str()),
        (StatusCode::BAD_REQUEST, "bad_request")
    );
    let bad = f.get("/api/courses?level=abc", None).await;
    assert_eq!(
        (bad.status, bad.code().as_str()),
        (StatusCode::BAD_REQUEST, "bad_request")
    );

    let detail = f.get("/api/courses/15-122?term=S27", None).await.json();
    assert_eq!(detail["code"], "15-122");
    assert_eq!(detail["offerings"].as_array().unwrap().len(), 2);
    assert_eq!(detail["offerings"][0]["termId"], "S27");
    let sections = detail["sections"].as_array().unwrap();
    assert_eq!(sections.len(), 4);
    assert_eq!(
        sections[0]["meetings"][0],
        json!({"days": [0, 2, 4], "start": 600, "end": 680})
    );
    assert!(
        f.get("/api/courses/15122", None)
            .await
            .json()
            .get("sections")
            .is_none()
    );
    assert_eq!(
        f.get("/api/courses/12-345", None).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn schedules_are_validated_revisioned_and_owner_scoped() {
    let f = fixture();
    let created = f
        .write("POST", "/api/schedules", "alice", Some(schedule_body()))
        .await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.text());
    let s = created.json();
    assert_eq!(s["revision"], 1);
    assert_eq!(s["visibility"], "private");
    assert_eq!(s["shareId"], Value::Null);
    assert_eq!(s["entries"][0]["child"], "A");
    let id = s["id"].as_str().unwrap().to_owned();

    // Bob can't see, change, share or delete it.
    assert_eq!(f.get("/api/schedules", Some("bob")).await.json(), json!([]));
    let mut update = schedule_body();
    update["revision"] = json!(1);
    update["visibility"] = json!("private");
    for (method, uri, body) in [
        ("PUT", format!("/api/schedules/{id}"), Some(update.clone())),
        ("DELETE", format!("/api/schedules/{id}"), None),
        ("POST", format!("/api/schedules/{id}/share"), None),
        ("DELETE", format!("/api/schedules/{id}/share"), None),
    ] {
        let r = f.write(method, &uri, "bob", body).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{method} {uri}");
    }

    update["name"] = json!("Renamed");
    let saved = f
        .write(
            "PUT",
            &format!("/api/schedules/{id}"),
            "alice",
            Some(update.clone()),
        )
        .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.text());
    assert_eq!(saved.json()["revision"], 2);
    assert_eq!(saved.json()["name"], "Renamed");

    // A stale write gets the current schedule.
    update["name"] = json!("Stale");
    let stale = f
        .write(
            "PUT",
            &format!("/api/schedules/{id}"),
            "alice",
            Some(update.clone()),
        )
        .await;
    assert_eq!(stale.status, StatusCode::CONFLICT);
    let body = stale.json();
    assert_eq!(body["code"], "conflict");
    assert_eq!(body["current"]["name"], "Renamed");
    assert_eq!(body["current"]["revision"], 2);

    let list = f.get("/api/schedules?term=S27", Some("alice")).await.json();
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(
        f.get("/api/schedules?term=F26", Some("alice")).await.json(),
        json!([])
    );

    // A client id makes creates idempotent: the second gets 409 with the first.
    let mut own = schedule_body();
    own["id"] = json!("my-id_1");
    assert_eq!(
        f.write("POST", "/api/schedules", "alice", Some(own.clone()))
            .await
            .status,
        StatusCode::CREATED
    );
    let again = f
        .write("POST", "/api/schedules", "alice", Some(own.clone()))
        .await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(again.json()["current"]["id"], "my-id_1");
    // The same id is fine for someone else.
    assert_eq!(
        f.write("POST", "/api/schedules", "bob", Some(own))
            .await
            .status,
        StatusCode::CREATED
    );

    assert_eq!(
        f.write("DELETE", &format!("/api/schedules/{id}"), "alice", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.write("DELETE", &format!("/api/schedules/{id}"), "alice", None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn schedules_must_match_the_catalog() {
    let f = fixture();
    let cases = [
        (json!({"termId": "X99", "name": "x"}), "no term"),
        (json!({"termId": "S27", "name": " "}), "1 to 120"),
        (
            json!({"termId": "S27", "name": "x".repeat(121)}),
            "1 to 120",
        ),
        (
            json!({"termId": "S27", "name": "x", "entries": [{"courseId": "15445"}]}),
            "isn't offered",
        ),
        (
            json!({"termId": "S27", "name": "x", "entries": [{"courseId": "15-122"}]}),
            "isn't a course id",
        ),
        (
            json!({"termId": "S27", "name": "x", "entries": [{"courseId": "15122", "section": "Z"}]}),
            "no section Z",
        ),
        (
            json!({"termId": "S27", "name": "x", "entries": [{"courseId": "15122", "section": "A"}]}),
            "belongs to 1",
        ),
        (
            json!({"termId": "S27", "name": "x", "entries": [{"courseId": "15122", "section": "1", "child": "B"}]}),
            "isn't a section of 1",
        ),
        (
            json!({"termId": "S27", "name": "x", "entries": [{"courseId": "15122", "child": "A"}]}),
            "pick a section",
        ),
        (
            json!({"termId": "S27", "name": "x", "entries": [{"courseId": "15122"}, {"courseId": "15122"}]}),
            "twice",
        ),
        (
            json!({"termId": "S27", "name": "x", "visibility": "public"}),
            "",
        ),
        (
            json!({"termId": "S27", "name": "x", "id": "../x"}),
            "Ids are",
        ),
        (json!({"termId": "S27"}), ""),
    ];
    for (body, message) in cases {
        let r = f
            .write("POST", "/api/schedules", "alice", Some(body.clone()))
            .await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{body}: {}", r.text());
        assert_eq!(r.code(), "bad_request");
        assert!(
            r.json()["message"].as_str().unwrap().contains(message),
            "{body}: {}",
            r.text()
        );
    }
    let ok = f
        .write(
            "POST",
            "/api/schedules",
            "alice",
            Some(json!({"termId": "S27", "name": "x", "entries": [{"courseId": "15122"}]})),
        )
        .await;
    assert_eq!(ok.status, StatusCode::CREATED);
    assert_eq!(
        ok.json()["entries"][0],
        json!({"courseId": "15122", "section": null, "child": null, "passFail": false, "color": 0, "hidden": false})
    );
}

#[tokio::test]
async fn share_links_hide_the_owner_and_can_be_revoked() {
    let f = fixture();
    let s = f
        .write("POST", "/api/schedules", "alice", Some(schedule_body()))
        .await
        .json();
    let id = s["id"].as_str().unwrap();
    let link = f
        .write("POST", &format!("/api/schedules/{id}/share"), "alice", None)
        .await
        .json();
    let token = link["shareId"].as_str().unwrap().to_owned();
    assert_eq!(link["url"], format!("{ORIGIN}/schedules/shared/{token}"));
    // Sharing again keeps the link.
    let again = f
        .write("POST", &format!("/api/schedules/{id}/share"), "alice", None)
        .await
        .json();
    assert_eq!(again["shareId"], token);

    let view = f.get(&format!("/api/shared-schedules/{token}"), None).await;
    assert_eq!(view.status, StatusCode::OK);
    let view = view.json();
    assert_eq!(view["name"], "Plan A");
    for private in ["id", "owner", "visibility", "revision", "shareId"] {
        assert!(view.get(private).is_none(), "{private}");
    }
    assert_eq!(
        f.write(
            "DELETE",
            &format!("/api/schedules/{id}/share"),
            "alice",
            None
        )
        .await
        .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.get(&format!("/api/shared-schedules/{token}"), None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
}

fn plan_body() -> Value {
    json!({
        "name": "Four years",
        "programs": [{"catalogId": 12, "auditId": 345}],
        "startTerm": "F25",
        "terms": [
            {"term": "F25", "courses": [{"id": "c1", "courseId": "15122"}, {"id": "c2", "courseId": "21127", "passFail": true, "units": 9}]},
            {"term": "S26", "courses": [], "link": {"scheduleId": "sched-1"}}
        ]
    })
}

#[tokio::test]
async fn plans_round_trip_and_conflict() {
    let f = fixture();
    let created = f
        .write("POST", "/api/plans", "alice", Some(plan_body()))
        .await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.text());
    let plan = created.json();
    let id = plan["id"].as_str().unwrap();
    assert_eq!(
        plan["terms"][0]["courses"][0],
        json!({"id": "c1", "courseId": "15122"})
    );
    assert_eq!(
        plan["terms"][0]["courses"][1],
        json!({"id": "c2", "courseId": "21127", "passFail": true, "units": 9.0})
    );
    assert_eq!(plan["terms"][0]["link"], Value::Null);
    assert_eq!(plan["terms"][1]["link"], json!({"scheduleId": "sched-1"}));
    assert_eq!(f.get("/api/plans", Some("bob")).await.json(), json!([]));

    let mut update = plan_body();
    update["revision"] = json!(1);
    update["name"] = json!("Three years");
    assert_eq!(
        f.write(
            "PUT",
            &format!("/api/plans/{id}"),
            "bob",
            Some(update.clone())
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
    let saved = f
        .write(
            "PUT",
            &format!("/api/plans/{id}"),
            "alice",
            Some(update.clone()),
        )
        .await;
    assert_eq!(saved.json()["revision"], 2);
    let stale = f
        .write(
            "PUT",
            &format!("/api/plans/{id}"),
            "alice",
            Some(update.clone()),
        )
        .await;
    assert_eq!(stale.status, StatusCode::CONFLICT);
    assert_eq!(stale.json()["current"]["name"], "Three years");

    for (path, value) in [
        ("/startTerm", json!("Fall 2025")),
        ("/terms/0/courses/0/courseId", json!("15-122")),
        ("/terms/0/courses/1/id", json!("c1")),
        ("/terms/0/courses/1/units", json!(-1)),
        ("/terms/1/term", json!("F25")),
    ] {
        let mut bad = plan_body();
        *bad.pointer_mut(path).unwrap() = value;
        let r = f.write("POST", "/api/plans", "alice", Some(bad)).await;
        assert_eq!(r.status, StatusCode::BAD_REQUEST, "{path}: {}", r.text());
    }
    assert_eq!(
        f.write("DELETE", &format!("/api/plans/{id}"), "bob", None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        f.write("DELETE", &format!("/api/plans/{id}"), "alice", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
}

fn record_body(revision: i64) -> Value {
    json!({
        "entries": [
            {"id": "e1", "courseId": "15122", "source": "taken", "term": "S27", "addedAt": 1},
            {"id": "e2", "courseId": "15112", "source": "taken", "term": "F26", "grade": "A", "addedAt": 2},
            {"id": "e3", "courseId": null, "source": "transfer", "units": 9, "institution": "Pitt", "label": "MATH 0230", "addedAt": 3},
            {"id": "e4", "courseId": "21127", "source": "exam", "exam": {"id": "ap-calc", "score": "5"}, "addedAt": 4}
        ],
        "overrides": {"15122": {"prereqs": true, "note": "Instructor permission", "updatedAt": 5}},
        "profile": {"entryTerm": "F26", "college": "SCS", "majors": ["CS"], "level": "undergraduate"},
        "revision": revision
    })
}

#[tokio::test]
async fn the_record_and_preferences_are_one_revisioned_document_each() {
    let f = fixture();
    let empty = f.get("/api/record", Some("alice")).await.json();
    assert_eq!(
        empty,
        json!({"entries": [], "overrides": {}, "profile": {}, "revision": 0, "updatedAt": 0})
    );
    let created = f
        .write("PUT", "/api/record", "alice", Some(record_body(0)))
        .await;
    assert_eq!(created.status, StatusCode::OK, "{}", created.text());
    assert_eq!(created.json()["revision"], 1);
    assert_eq!(created.json()["entries"][2]["courseId"], Value::Null);
    assert_eq!(
        created.json()["overrides"]["15122"],
        json!({"prereqs": true, "note": "Instructor permission", "updatedAt": 5})
    );
    // Creating again conflicts with what's there.
    let again = f
        .write("PUT", "/api/record", "alice", Some(record_body(0)))
        .await;
    assert_eq!(again.status, StatusCode::CONFLICT);
    assert_eq!(again.json()["current"]["revision"], 1);
    // Updating something that doesn't exist conflicts with the empty record.
    let ghost = f
        .write("PUT", "/api/record", "bob", Some(record_body(3)))
        .await;
    assert_eq!(ghost.status, StatusCode::CONFLICT);
    assert_eq!(ghost.json()["current"]["revision"], 0);
    assert_eq!(
        f.get("/api/record", Some("bob")).await.json()["revision"],
        0
    );
    assert_eq!(
        f.write("PUT", "/api/record", "alice", Some(record_body(1)))
            .await
            .json()["revision"],
        2
    );
    assert_eq!(
        f.get("/api/record", Some("alice")).await.json()["entries"]
            .as_array()
            .unwrap()
            .len(),
        4
    );

    for (path, value) in [
        ("/entries/0/source", json!("audit")),
        ("/entries/0/courseId", json!("15-122")),
        ("/entries/0/term", json!("Fall 2026")),
        ("/entries/2/institution", json!("x".repeat(201))),
        ("/profile/level", json!("phd")),
    ] {
        let mut bad = record_body(2);
        *bad.pointer_mut(path).unwrap() = value;
        assert_eq!(
            f.write("PUT", "/api/record", "alice", Some(bad))
                .await
                .status,
            StatusCode::BAD_REQUEST,
            "{path}"
        );
    }

    let prefs = f.get("/api/preferences", Some("alice")).await.json();
    assert_eq!(
        prefs,
        json!({
            "calendarDisplay": {"section": true, "time": true, "location": true, "title": false},
            "activeSchedule": {}, "activePlanId": null, "planLayout": "cards", "sectionPicker": "dropdown",
            "onboarding": {"asked": false, "promptHidden": false}, "revision": 0, "updatedAt": 0
        })
    );
    let body = json!({
        "calendarDisplay": {"section": false, "time": true, "location": true, "title": true},
        "activeSchedule": {"S27": "abc"}, "activePlanId": "p1", "planLayout": "table", "sectionPicker": "compact",
        "onboarding": {"asked": true}, "revision": 0
    });
    let saved = f
        .write("PUT", "/api/preferences", "alice", Some(body.clone()))
        .await;
    assert_eq!(saved.status, StatusCode::OK, "{}", saved.text());
    assert_eq!(saved.json()["planLayout"], "table");
    assert_eq!(saved.json()["sectionPicker"], "compact");
    assert_eq!(saved.json()["calendarDisplay"]["title"], true);
    assert_eq!(
        saved.json()["onboarding"],
        json!({"asked": true, "promptHidden": false})
    );
    let mut bad = body;
    bad["revision"] = json!(1);
    bad["activeSchedule"] = json!({"spring": "abc"});
    assert_eq!(
        f.write("PUT", "/api/preferences", "alice", Some(bad))
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        f.get("/api/preferences", Some("bob")).await.json()["revision"],
        0
    );
}

#[tokio::test]
async fn saved_courses() {
    let f = fixture();
    assert_eq!(
        f.write("PUT", "/api/saved/15122", "alice", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.write("PUT", "/api/saved/15122", "alice", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.write("PUT", "/api/saved/21127", "alice", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.write("PUT", "/api/saved/12345", "alice", None)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        f.write("PUT", "/api/saved/15-122", "alice", None)
            .await
            .status,
        StatusCode::BAD_REQUEST
    );
    let list = f.get("/api/saved", Some("alice")).await.json();
    let ids: Vec<&str> = list
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["courseId"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&"15122") && ids.contains(&"21127"));
    assert_eq!(f.get("/api/saved", Some("bob")).await.json(), json!([]));
    assert_eq!(
        f.write("DELETE", "/api/saved/15122", "bob", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.get("/api/saved", Some("alice"))
            .await
            .json()
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        f.write("DELETE", "/api/saved/15122", "alice", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.get("/api/saved", Some("alice"))
            .await
            .json()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        f.get("/api/saved", None).await.status,
        StatusCode::UNAUTHORIZED
    );
}

/// Makes `a` and `b` accepted friends; returns the friendship id.
async fn befriend(f: &Fixture, a: &str, b: &str) -> String {
    f.get("/api/me", Some(b)).await;
    let request = f
        .write("POST", "/api/friends", a, Some(json!({"andrewId": b})))
        .await;
    assert_eq!(request.status, StatusCode::OK, "{}", request.text());
    let id = request.json()["id"].as_str().unwrap().to_owned();
    assert_eq!(request.json()["status"], "outgoing");
    // Only the recipient can accept.
    assert_eq!(
        f.write("POST", &format!("/api/friends/{id}/accept"), a, None)
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        f.get("/api/friends", Some(b)).await.json()[0]["status"],
        "incoming"
    );
    assert_eq!(
        f.write("POST", &format!("/api/friends/{id}/accept"), b, None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    id
}

#[tokio::test]
async fn friends_see_only_what_is_shared() {
    let f = fixture();
    // Alice: a friends-visible schedule (one course hidden), a private one, and an in-progress course on her record.
    let mut visible = schedule_body();
    visible["visibility"] = json!("friends");
    f.write("POST", "/api/schedules", "alice", Some(visible))
        .await;
    f.write(
        "POST",
        "/api/schedules",
        "alice",
        Some(json!({"termId": "S27", "name": "Secret", "entries": [{"courseId": "15122"}]})),
    )
    .await;
    let mut record = record_body(0);
    record["entries"][0]["courseId"] = json!("15445");
    f.write("PUT", "/api/record", "alice", Some(record)).await;
    f.get("/api/me", Some("alice")).await;
    f.get("/api/me", Some("carol")).await;

    let id = befriend(&f, "bob", "alice").await;
    let friends = f.get("/api/friends", Some("bob")).await.json();
    assert_eq!(friends[0]["name"], "alice");
    assert_eq!(friends[0]["status"], "accepted");
    assert_eq!(friends[0]["sharesSchedules"], false);

    // Friendship alone shares nothing.
    let schedules = f
        .get(
            &format!("/api/friends/{id}/schedules?term=S27"),
            Some("bob"),
        )
        .await;
    assert_eq!(schedules.json(), json!([]));
    assert_eq!(
        f.get("/api/friends/courses?term=S27", Some("bob"))
            .await
            .json(),
        json!({})
    );

    // Alice shares schedules: Bob sees the friends-visible one only, and its courses that aren't hidden.
    let sharing = f
        .write(
            "PUT",
            "/api/friends/sharing",
            "alice",
            Some(json!({"shareCourses": false, "shareSchedules": true})),
        )
        .await;
    assert_eq!(sharing.status, StatusCode::OK);
    assert_eq!(
        f.get("/api/friends/sharing", Some("alice")).await.json(),
        json!({"shareCourses": false, "shareSchedules": true})
    );
    let schedules = f
        .get(
            &format!("/api/friends/{id}/schedules?term=S27"),
            Some("bob"),
        )
        .await
        .json();
    assert_eq!(schedules.as_array().unwrap().len(), 1);
    assert_eq!(schedules[0]["name"], "Plan A");
    assert!(schedules[0].get("visibility").is_none() && schedules[0].get("shareId").is_none());
    assert_eq!(
        f.get("/api/friends/courses?term=S27", Some("bob"))
            .await
            .json(),
        json!({"15122": ["alice"]})
    );

    // Sharing courses adds the record's in-progress course for that term, not graded ones.
    f.write(
        "PUT",
        "/api/friends/sharing",
        "alice",
        Some(json!({"shareCourses": true, "shareSchedules": true})),
    )
    .await;
    assert_eq!(
        f.get("/api/friends/courses?term=S27", Some("bob"))
            .await
            .json(),
        json!({"15122": ["alice"], "15445": ["alice"]})
    );
    assert_eq!(
        f.get("/api/friends/courses?term=F26", Some("bob"))
            .await
            .json(),
        json!({})
    );
    assert_eq!(
        f.get("/api/friends/courses", Some("bob")).await.status,
        StatusCode::BAD_REQUEST
    );

    // Sharing is one-way: Alice sees nothing of Bob's, and Carol, not a friend, sees nothing of Alice's.
    assert_eq!(
        f.get("/api/friends/courses?term=S27", Some("alice"))
            .await
            .json(),
        json!({})
    );
    assert_eq!(
        f.get(&format!("/api/friends/{id}/schedules"), Some("carol"))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        f.get("/api/friends/courses?term=S27", Some("carol"))
            .await
            .json(),
        json!({})
    );

    // Ending the friendship ends access at once.
    assert_eq!(
        f.write("DELETE", &format!("/api/friends/{id}"), "alice", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.get(&format!("/api/friends/{id}/schedules"), Some("bob"))
            .await
            .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        f.get("/api/friends/courses?term=S27", Some("bob"))
            .await
            .json(),
        json!({})
    );
}

#[tokio::test]
async fn invites_are_single_use_and_requests_need_consent() {
    let f = fixture();
    f.get("/api/me", Some("alice")).await;
    let unknown = f
        .write(
            "POST",
            "/api/friends",
            "alice",
            Some(json!({"andrewId": "nobody"})),
        )
        .await;
    assert_eq!(unknown.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        f.write(
            "POST",
            "/api/friends",
            "alice",
            Some(json!({"andrewId": "alice"}))
        )
        .await
        .status,
        StatusCode::BAD_REQUEST
    );
    let invite = f
        .write("POST", "/api/friends/invites", "alice", None)
        .await
        .json();
    let token = invite["token"].as_str().unwrap().to_owned();
    assert_eq!(invite["url"], format!("{ORIGIN}/invite/{token}"));
    let info_uri = format!("/api/friends/invites/{token}");
    assert_eq!(
        f.get(&info_uri, None).await.status,
        StatusCode::UNAUTHORIZED
    );
    let info = f.get(&info_uri, Some("bob")).await;
    assert_eq!(info.status, StatusCode::OK, "{}", info.text());
    assert_eq!(info.json()["andrewId"], "alice");
    assert_eq!(info.json()["own"], false);
    assert_eq!(
        info.json()["expiresAt"],
        invite["expiresAt"].as_i64().unwrap() / 1000 * 1000
    );
    assert_eq!(f.get(&info_uri, Some("alice")).await.json()["own"], true);
    let redeemed = f
        .write(
            "POST",
            &format!("/api/friends/invites/{token}/redeem"),
            "bob",
            None,
        )
        .await;
    assert_eq!(redeemed.status, StatusCode::OK, "{}", redeemed.text());
    assert_eq!(redeemed.json()["status"], "accepted");
    assert_eq!(redeemed.json()["andrewId"], "alice");
    assert_eq!(
        f.write(
            "POST",
            &format!("/api/friends/invites/{token}/redeem"),
            "carol",
            None
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        f.get("/api/friends", Some("alice")).await.json()[0]["status"],
        "accepted"
    );
    assert_eq!(
        f.get(&info_uri, Some("carol")).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn deleting_an_account_removes_everything_it_owns() {
    let f = fixture();
    f.write("POST", "/api/schedules", "alice", Some(schedule_body()))
        .await;
    f.write("POST", "/api/plans", "alice", Some(plan_body()))
        .await;
    f.write("PUT", "/api/record", "alice", Some(record_body(0)))
        .await;
    f.write("PUT", "/api/saved/15122", "alice", None).await;
    f.write("POST", "/api/schedules", "bob", Some(schedule_body()))
        .await;
    befriend(&f, "bob", "alice").await;
    f.state
        .db
        .run(|db| {
            db.execute_batch(
                "INSERT INTO sessions VALUES ('h1', 'alice', '{}', 9999999999), ('h2', 'bob', '{}', 9999999999);
                 INSERT INTO schedules VALUES ('legacy', 'alice', '{}', 1, NULL);",
            )?;
            Ok(())
        })
        .await
        .unwrap();

    let gone = f.write("DELETE", "/api/account", "alice", None).await;
    assert_eq!(gone.status, StatusCode::NO_CONTENT);
    let counts: Vec<(String, i64)> = f
        .state
        .db
        .run(|db| {
            let mut out = vec![];
            for table in [
                "user_schedules",
                "user_plans",
                "user_documents",
                "user_saved",
                "sessions",
                "schedules",
            ] {
                out.push((
                    table.to_owned(),
                    db.query_row(
                        &format!("SELECT count(*) FROM {table} WHERE owner = 'alice'"),
                        [],
                        |r| r.get(0),
                    )?,
                ));
            }
            out.push((
                "profiles".into(),
                db.query_row(
                    "SELECT count(*) FROM profiles WHERE subject = 'alice'",
                    [],
                    |r| r.get(0),
                )?,
            ));
            out.push((
                "friendships".into(),
                db.query_row("SELECT count(*) FROM friendships", [], |r| r.get(0))?,
            ));
            out.push((
                "bob".into(),
                db.query_row(
                    "SELECT count(*) FROM user_schedules WHERE owner = 'bob'",
                    [],
                    |r| r.get(0),
                )?,
            ));
            out.push((
                "bob sessions".into(),
                db.query_row(
                    "SELECT count(*) FROM sessions WHERE owner = 'bob'",
                    [],
                    |r| r.get(0),
                )?,
            ));
            Ok(out)
        })
        .await
        .unwrap();
    for (table, count) in counts {
        if table.starts_with("bob") {
            assert!(count > 0, "{table}");
        } else {
            assert_eq!(count, 0, "{table}");
        }
    }
    assert_eq!(f.get("/api/friends", Some("bob")).await.json(), json!([]));
    assert_eq!(
        f.get("/api/record", Some("alice")).await.json()["revision"],
        0
    );
}

#[tokio::test]
async fn writes_need_this_origin_and_stay_within_limits() {
    let f = fixture();
    for origin in [None, Some("https://evil.test"), Some("null")] {
        let mut req = Request::builder()
            .method("PUT")
            .uri("/api/saved/15122")
            .header("x-test-user", "alice");
        if let Some(o) = origin {
            req = req.header(header::ORIGIN, o);
        }
        let r = f.send(req.body(Body::empty()).unwrap()).await;
        assert_eq!(
            (r.status, r.code().as_str()),
            (StatusCode::FORBIDDEN, "forbidden"),
            "{origin:?}"
        );
    }
    assert_eq!(f.get("/api/saved", Some("alice")).await.json(), json!([]));

    let mut huge = schedule_body();
    huge["name"] = json!("x".repeat(200 * 1024));
    let r = f.write("POST", "/api/schedules", "alice", Some(huge)).await;
    assert_eq!(
        (r.status, r.code().as_str()),
        (StatusCode::PAYLOAD_TOO_LARGE, "too_large")
    );

    let bad_json = f
        .send(
            Fixture::request("POST", "/api/schedules", Some("alice"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{not json"))
                .unwrap(),
        )
        .await;
    assert_eq!(
        (bad_json.status, bad_json.code().as_str()),
        (StatusCode::BAD_REQUEST, "bad_request")
    );
    let r = f.get("/api/nope", None).await;
    assert_eq!(
        (r.status, r.code().as_str()),
        (StatusCode::NOT_FOUND, "not_found")
    );
    let r = f.write("PATCH", "/api/schedules", "alice", None).await;
    assert_eq!(
        (r.status, r.code().as_str()),
        (StatusCode::METHOD_NOT_ALLOWED, "bad_request")
    );

    // The daily cap per record.
    let s = f
        .write("POST", "/api/schedules", "alice", Some(schedule_body()))
        .await
        .json();
    let id = s["id"].as_str().unwrap().to_owned();
    let today = crate::db::utc_day(crate::db::now_ms());
    f.state
        .db
        .run(move |db| {
            db.execute(
                "UPDATE user_schedules SET day = ?, day_writes = 500",
                [today],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    let mut update = schedule_body();
    update["revision"] = json!(1);
    update["visibility"] = json!("private");
    let capped = f
        .write(
            "PUT",
            &format!("/api/schedules/{id}"),
            "alice",
            Some(update),
        )
        .await;
    assert_eq!(
        (capped.status, capped.code().as_str()),
        (StatusCode::TOO_MANY_REQUESTS, "too_many")
    );
    assert!(capped.header(header::RETRY_AFTER).parse::<u64>().unwrap() <= 86_400);
}

#[tokio::test]
async fn writes_per_minute_are_limited_per_user() {
    let f = fixture_with(Options {
        writes_per_minute: 2,
        ..Options::default()
    });
    for _ in 0..2 {
        assert_eq!(
            f.write("PUT", "/api/saved/15122", "alice", None)
                .await
                .status,
            StatusCode::NO_CONTENT
        );
    }
    let limited = f.write("PUT", "/api/saved/15122", "alice", None).await;
    assert_eq!(
        (limited.status, limited.code().as_str()),
        (StatusCode::TOO_MANY_REQUESTS, "too_many")
    );
    assert!(!limited.header(header::RETRY_AFTER).is_empty());
    // Reads and other users aren't limited.
    assert_eq!(
        f.get("/api/saved", Some("alice")).await.status,
        StatusCode::OK
    );
    assert_eq!(
        f.write("PUT", "/api/saved/15122", "bob", None).await.status,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn syllabi_are_for_members_with_safe_headers() {
    let f = fixture();
    let anon = f.get("/api/syllabi/F25/CS/15122-1.pdf", None).await;
    assert_eq!(
        (anon.status, anon.code().as_str()),
        (StatusCode::UNAUTHORIZED, "auth")
    );
    assert_eq!(
        f.get("/api/syllabi/F25/CS/15122-1.pdf", Some("mallory@gmail.com"))
            .await
            .status,
        StatusCode::FORBIDDEN
    );

    let pdf = f
        .get("/api/syllabi/F25/CS/15122-1.pdf", Some("alice"))
        .await;
    assert_eq!(pdf.status, StatusCode::OK);
    assert_eq!(&pdf.bytes[..], b"%PDF-1.4 test");
    assert_eq!(pdf.header(header::CONTENT_TYPE), "application/pdf");
    assert!(
        pdf.header(header::CONTENT_DISPOSITION)
            .starts_with("inline; filename=\"F25-15122-1.pdf\"")
    );
    assert_eq!(pdf.header(header::X_FRAME_OPTIONS), "SAMEORIGIN");
    assert_eq!(
        pdf.header(header::CONTENT_SECURITY_POLICY),
        "default-src 'none'; frame-ancestors 'self'"
    );
    assert_eq!(pdf.header(header::CACHE_CONTROL), "private, max-age=3600");
    assert_eq!(pdf.header(header::VARY), "Cookie");
    let etag = pdf.header(header::ETAG).to_owned();
    let cached = f
        .send(
            Fixture::request("GET", "/api/syllabi/F25/CS/15122-1.pdf", Some("alice"))
                .header(header::IF_NONE_MATCH, etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(cached.status, StatusCode::NOT_MODIFIED);

    let download = f
        .get("/api/syllabi/F25/CS/15122-1.pdf?download=1", Some("alice"))
        .await;
    assert!(
        download
            .header(header::CONTENT_DISPOSITION)
            .starts_with("attachment;")
    );
    let docx = f
        .get("/api/syllabi/F25/CS/15122%20notes.docx", Some("alice"))
        .await;
    assert_eq!(docx.status, StatusCode::OK);
    assert!(
        docx.header(header::CONTENT_DISPOSITION)
            .starts_with("attachment; filename=\"F25-15122 notes.docx\"")
    );
    assert_eq!(docx.header(header::X_FRAME_OPTIONS), "DENY");
    assert!(
        docx.header(header::CONTENT_SECURITY_POLICY)
            .contains("sandbox")
    );

    for bad in [
        "F25/CS/missing.pdf",
        "F25/CS/..%2F..%2Fusers.pdf",
        "F25/cs/15122-1.pdf",
        "F25/CS/15122-1.exe",
    ] {
        let r = f.get(&format!("/api/syllabi/{bad}"), Some("alice")).await;
        assert_eq!(r.status, StatusCode::NOT_FOUND, "{bad}");
    }
    let unconfigured = fixture_with(Options {
        syllabi: false,
        ..Options::default()
    });
    let r = unconfigured
        .get("/api/syllabi/F25/CS/15122-1.pdf", Some("alice"))
        .await;
    assert_eq!(
        (r.status, r.code().as_str()),
        (StatusCode::SERVICE_UNAVAILABLE, "unavailable")
    );
}

#[tokio::test]
async fn course_pages_sitemap_and_robots() {
    let f = fixture();
    let page = f.get("/course/15-122", None).await;
    assert_eq!(page.status, StatusCode::OK);
    assert!(page.header(header::CONTENT_TYPE).starts_with("text/html"));
    let html = page.text();
    assert!(
        html.contains("<link rel=\"canonical\" href=\"https://courses.test/course/15-122\" />")
    );
    assert!(
        html.contains("<title>15-122 Principles of Imperative Computation | CMU Courses</title>")
    );
    assert!(html.contains("&lt;careful&gt;"));
    assert!(!html.contains("<careful>"));
    assert!(html.contains("Offered: Spring 2027, Fall 2026"));
    assert_eq!(f.get("/course/15122", None).await.text(), html);
    assert_eq!(f.get("/course/12-345", None).await.text(), TEMPLATE);
    assert_eq!(
        f.get("/course/99-999", None).await.text(),
        TEMPLATE,
        "code-only titles get no page"
    );
    assert_eq!(f.get("/course/not-a-code", None).await.text(), TEMPLATE);

    let sitemap = f.get("/sitemap.xml", None).await;
    assert!(
        sitemap
            .header(header::CONTENT_TYPE)
            .starts_with("application/xml")
    );
    let xml = sitemap.text();
    assert!(xml.contains("<loc>https://courses.test/</loc>"));
    for code in ["15-122", "15-112", "21-127", "15-445"] {
        assert!(
            xml.contains(&format!("<loc>https://courses.test/course/{code}</loc>")),
            "{code}"
        );
    }
    assert!(!xml.contains("99-999"));

    let robots = f.get("/robots.txt", None).await.text();
    for path in [
        "/api/",
        "/auth/",
        "/schedules",
        "/plan",
        "/profile",
        "/finals",
        "/instructors",
    ] {
        assert!(robots.contains(&format!("Disallow: {path}\n")), "{path}");
    }
    assert!(robots.contains("Sitemap: https://courses.test/sitemap.xml"));

    let no_site = fixture_with(Options {
        site: false,
        ..Options::default()
    });
    assert_eq!(
        no_site.get("/course/15-122", None).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn finals_imports_are_private() {
    let f = fixture();
    let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:15-122 Final Exam\r\nDTSTART;TZID=America/New_York:20270505T090000\r\nDTEND;TZID=America/New_York:20270505T120000\r\nLOCATION:Wean 7500\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let boundary = "XBOUNDARY";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"calendar\"; filename=\"sio.ics\"\r\nContent-Type: text/calendar\r\n\r\n{ics}\r\n--{boundary}--\r\n"
    );
    let imported = f
        .send(
            Fixture::request("POST", "/api/finals/import?term=S27", Some("alice"))
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(body))
                .unwrap(),
        )
        .await;
    assert_eq!(imported.status, StatusCode::OK, "{}", imported.text());
    assert_eq!(imported.json()[0]["courseId"], "15122");
    assert_eq!(
        f.get("/api/finals?term=S27", Some("alice"))
            .await
            .json()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        f.get("/api/finals?term=S27&courses=21127", Some("alice"))
            .await
            .json(),
        json!([])
    );
    assert_eq!(
        f.get("/api/finals?term=S27", Some("bob")).await.json(),
        json!([])
    );
    assert_eq!(
        f.get("/api/finals?term=S27", None).await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        f.write("DELETE", "/api/finals/import?term=S27", "bob", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.get("/api/finals?term=S27", Some("alice"))
            .await
            .json()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        f.write("DELETE", "/api/finals/import?term=S27", "alice", None)
            .await
            .status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.get("/api/finals?term=S27", Some("alice")).await.json(),
        json!([])
    );
}

#[tokio::test]
async fn logout_clears_the_session() {
    let f = fixture();
    let me = f.get("/api/me", Some("alice")).await;
    let cookie = me
        .header(header::SET_COOKIE)
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let out = f
        .send(
            Fixture::request("POST", "/auth/logout", None)
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(out.status, StatusCode::NO_CONTENT);
    let left: i64 = f
        .state
        .db
        .run(|db| Ok(db.query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))?))
        .await
        .unwrap();
    assert_eq!(left, 0);
    let login = f.get("/auth/login?returnTo=//evil.test", None).await;
    assert_eq!(login.header(header::LOCATION), "/");
    let login = f
        .get("/auth/login?returnTo=/schedules%3Fterm%3DS27", None)
        .await;
    assert_eq!(login.header(header::LOCATION), "/schedules?term=S27");
}

/// `sites/web/src/lib/api/openapi.json` is generated by `cargo run -p courses-web-api -- openapi`; it must match.
#[test]
fn committed_openapi_document_is_current() {
    let committed: Value =
        serde_json::from_str(include_str!("../../../sites/web/src/lib/api/openapi.json")).unwrap();
    let generated = serde_json::to_value(app::openapi()).unwrap();
    assert!(
        committed == generated,
        "regenerate it: cargo run -p courses-web-api -- openapi > sites/web/src/lib/api/openapi.json"
    );
}
