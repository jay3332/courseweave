#!/usr/bin/env python3
"""Carries Courseweave accounts over to this instance. Standard library only.

  convert EXPORT CATALOG OUT   On your machine: turns a Courseweave D1 export (JSON rows of email, key, data) into
                               this app's record formats, checked against the catalog, as {email: account}.
  stage FILE DB                On the server: stages each account in DB's account_imports table, for the web API to
                               move to its owner at their first sign-in (src/imports.rs). Members who already use
                               this instance are skipped, and so is an email that's already staged.

Only counts are printed, never personal data.
"""

import json
import re
import sqlite3
import sys
import time
from collections import Counter

NAME_MAX = 120
SCHEDULES_MAX = 300
ENTRIES_MAX = 100
COLOR_MAX = 63
PLANS_MAX = 50
PLAN_TERMS_MAX = 40
PLAN_COURSES_MAX = 40
PROGRAMS_MAX = 10
RECORD_MAX = 600
SOURCES = {"taken", "transfer", "exam", "waiver"}
LEVELS = {"undergraduate", "graduate"}

COURSE = re.compile(r"\d{5}")
TERM = re.compile(r"[SMF]\d\d")
RECORD_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")

dropped = Counter()


def is_course(v):
    return isinstance(v, str) and COURSE.fullmatch(v) is not None


def is_term(v):
    return isinstance(v, str) and TERM.fullmatch(v) is not None


def is_id(v):
    return isinstance(v, str) and RECORD_ID.fullmatch(v) is not None


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def text(v, most):
    return isinstance(v, str) and len(v) <= most


def ms(v):
    return int(v) if is_num(v) and v >= 0 else 0


def name(v, fallback):
    v = v.strip() if isinstance(v, str) else ""
    return (v or fallback)[:NAME_MAX]


class Catalog:
    def __init__(self, path):
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        self.terms = {r[0] for r in db.execute("SELECT id FROM terms")}
        self.offered = set(db.execute("SELECT course_id, term_id FROM offerings"))
        self.parent = {(t, c, n): p for t, c, n, p in db.execute("SELECT term_id, course_id, name, parent FROM sections")}


def schedule_entries(raw, term, catalog):
    entries, seen = [], set()
    for e in raw if isinstance(raw, list) else []:
        if not isinstance(e, dict) or not is_course(e.get("courseId")) or e["courseId"] in seen:
            dropped["schedule entries (malformed)"] += 1
            continue
        course = e["courseId"]
        if (course, term) not in catalog.offered:
            dropped["schedule entries (not offered that semester)"] += 1
            continue
        seen.add(course)
        section, child = e.get("section"), e.get("child")
        if not (isinstance(section, str) and catalog.parent.get((term, course, section), "missing") is None):
            if section is not None:
                dropped["section choices (not in the catalog)"] += 1
            section, child = None, None
        elif child is not None and catalog.parent.get((term, course, child)) != section:
            dropped["section choices (not in the catalog)"] += 1
            child = None
        color = e.get("color")
        entries.append({
            "courseId": course,
            "section": section,
            "child": child,
            "passFail": e.get("passFail") is True,
            "color": color if is_int(color) and 0 <= color <= COLOR_MAX else 0,
            "hidden": e.get("hidden") is True,
        })
    return entries[:ENTRIES_MAX]


def schedules(doc, catalog):
    out = []
    raw = doc.get("schedules") if isinstance(doc.get("schedules"), dict) else {}
    for s in raw.values():
        if not isinstance(s, dict) or not is_id(s.get("id")) or s.get("termId") not in catalog.terms:
            dropped["schedules (bad id or unknown semester)"] += 1
            continue
        out.append({
            "id": s["id"],
            "termId": s["termId"],
            "name": name(s.get("name"), "Schedule"),
            "entries": schedule_entries(s.get("entries"), s["termId"], catalog),
            "createdAt": ms(s.get("createdAt")),
            "updatedAt": ms(s.get("updatedAt")),
        })
    out.sort(key=lambda s: (s["createdAt"], s["id"]))
    return out[:SCHEDULES_MAX]


def program(p):
    if not isinstance(p, dict) or not is_int(p.get("catalogId")) or not is_int(p.get("auditId")):
        return None
    out = {"catalogId": p["catalogId"], "auditId": p["auditId"]}
    c = p.get("concentrations")
    if isinstance(c, list) and all(is_int(x) for x in c) and len(c) <= 20:
        out["concentrations"] = c
    return out


def plan(p, schedule_ids):
    if not isinstance(p, dict) or not is_id(p.get("id")) or not is_term(p.get("startTerm")):
        return None
    programs = [x for x in map(program, p.get("programs") or []) if x][:PROGRAMS_MAX]
    terms, seen_terms, seen_ids = [], set(), set()
    for t in p.get("terms") or []:
        if not isinstance(t, dict) or not is_term(t.get("term")) or t["term"] in seen_terms:
            dropped["plan semesters (malformed)"] += 1
            continue
        seen_terms.add(t["term"])
        courses = []
        for c in t.get("courses") or []:
            if not isinstance(c, dict) or not is_id(c.get("id")) or c["id"] in seen_ids or not is_course(c.get("courseId")):
                dropped["plan courses (malformed)"] += 1
                continue
            seen_ids.add(c["id"])
            course = {"id": c["id"], "courseId": c["courseId"]}
            if c.get("passFail") is True:
                course["passFail"] = True
            if is_num(c.get("units")) and 0 <= c["units"] <= 1000:
                course["units"] = c["units"]
            courses.append(course)
        link = t.get("link")
        link = {"scheduleId": link["scheduleId"]} if isinstance(link, dict) and link.get("scheduleId") in schedule_ids else None
        terms.append({"term": t["term"], "courses": courses[:PLAN_COURSES_MAX], "link": link})
    return {
        "id": p["id"],
        "name": name(p.get("name"), "Plan"),
        "programs": programs,
        "startTerm": p["startTerm"],
        "terms": terms[:PLAN_TERMS_MAX],
        "createdAt": ms(p.get("createdAt")),
        "updatedAt": ms(p.get("updatedAt")),
    }


def record_entry(e):
    if not isinstance(e, dict) or not is_id(e.get("id")) or e.get("source") not in SOURCES:
        return None
    if e.get("courseId") is not None and not is_course(e.get("courseId")):
        return None
    out = {"id": e["id"], "courseId": e.get("courseId"), "source": e["source"], "addedAt": ms(e.get("addedAt"))}
    if is_term(e.get("term")):
        out["term"] = e["term"]
    if text(e.get("grade"), 8):
        out["grade"] = e["grade"]
    if is_num(e.get("units")) and 0 <= e["units"] <= 1000:
        out["units"] = e["units"]
    exam = e.get("exam")
    if isinstance(exam, dict) and text(exam.get("id"), 64) and text(exam.get("score"), 16):
        out["exam"] = {"id": exam["id"], "score": exam["score"]}
    for field, most in (("institution", 200), ("label", 200), ("note", 1000)):
        if text(e.get(field), most):
            out[field] = e[field]
    return out


def record(doc):
    entries = []
    for e in doc.get("entries") or []:
        converted = record_entry(e)
        if converted is None:
            dropped["record entries (malformed)"] += 1
        else:
            entries.append(converted)
    overrides = {}
    raw = doc.get("overrides") if isinstance(doc.get("overrides"), dict) else {}
    for course, o in raw.items():
        if not is_course(course) or not isinstance(o, dict):
            continue
        out = {k: True for k in ("prereqs", "coreqs", "antireqs") if o.get(k) is True}
        if text(o.get("note"), 1000):
            out["note"] = o["note"]
        out["updatedAt"] = ms(o.get("updatedAt"))
        overrides[course] = out
    raw = doc.get("profile") if isinstance(doc.get("profile"), dict) else {}
    profile = {k: raw[k] for k in ("entryTerm", "expectedGraduation") if is_term(raw.get(k))}
    if text(raw.get("college"), 16):
        profile["college"] = raw["college"]
    for k in ("majors", "minors"):
        items = raw.get(k)
        if isinstance(items, list) and len(items) <= 10 and all(text(i, 200) for i in items):
            profile[k] = items
    if raw.get("level") in LEVELS:
        profile["level"] = raw["level"]
    return {"entries": entries[:RECORD_MAX], "overrides": overrides, "profile": profile}


def account(docs, catalog):
    sched_doc = docs.get("schedules") or {}
    scheds = schedules(sched_doc, catalog)
    schedule_ids = {s["id"] for s in scheds}
    plan_doc = docs.get("plan") or {}
    raw_plans = plan_doc.get("plans") if isinstance(plan_doc.get("plans"), dict) else {}
    plans = []
    for p in raw_plans.values():
        converted = plan(p, schedule_ids)
        if converted is None:
            dropped["plans (malformed)"] += 1
        else:
            plans.append(converted)
    plans.sort(key=lambda p: (p["createdAt"], p["id"]))
    plans = plans[:PLANS_MAX]
    plan_ids = {p["id"] for p in plans}
    rec = record(docs.get("record") or {})
    bookmarks = sched_doc.get("bookmarks") if isinstance(sched_doc.get("bookmarks"), dict) else {}
    saved = sorted({c for ids in bookmarks.values() if isinstance(ids, list) for c in ids if is_course(c)})
    active = sched_doc.get("activeSchedule") if isinstance(sched_doc.get("activeSchedule"), dict) else {}
    active_plan = plan_doc.get("activePlanId")
    has_record = bool(rec["entries"] or rec["overrides"] or rec["profile"])
    if not (scheds or plans or has_record or saved):
        return None
    return {
        "schedules": scheds,
        "plans": plans,
        "record": rec if has_record else None,
        "preferences": {
            "activeSchedule": {t: i for t, i in active.items() if is_term(t) and i in schedule_ids},
            "activePlanId": active_plan if active_plan in plan_ids else None,
            "onboarding": {"asked": bool(rec["entries"]), "promptHidden": False},
        },
        "saved": saved,
    }


def convert(export_path, catalog_path, out_path):
    with open(export_path) as f:
        rows = json.load(f)
    if isinstance(rows, list) and rows and isinstance(rows[0], dict) and "results" in rows[0]:
        rows = rows[0]["results"]  # `wrangler d1 execute --json` output
    catalog = Catalog(catalog_path)
    docs = {}
    for row in rows:
        try:
            data = json.loads(row["data"])
        except (TypeError, ValueError):
            dropped["documents (not JSON)"] += 1
            continue
        docs.setdefault(row["email"].strip().lower(), {})[row["key"]] = data
    accounts = {}
    for email, account_docs in docs.items():
        converted = account(account_docs, catalog)
        if converted is None:
            dropped["accounts (nothing to carry over)"] += 1
        else:
            accounts[email] = converted
    with open(out_path, "w") as f:
        json.dump(accounts, f)
    print(f"{len(docs)} accounts read, {len(accounts)} to carry over")
    print(f"  {sum(len(a['schedules']) for a in accounts.values())} schedules, "
          f"{sum(len(a['plans']) for a in accounts.values())} plans, "
          f"{sum(1 for a in accounts.values() if a['record'])} records, "
          f"{sum(len(a['saved']) for a in accounts.values())} saved courses")
    for what, n in sorted(dropped.items()):
        print(f"  left out: {n} {what}")


TABLE = """CREATE TABLE IF NOT EXISTS account_imports(
  email TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  staged_at INTEGER NOT NULL
)"""


def stage(file_path, db_path):
    with open(file_path) as f:
        accounts = json.load(f)
    db = sqlite3.connect(db_path, timeout=10)
    # Members of this instance: the member each session verified, and friends' profiles.
    members = set()
    for (data,) in db.execute("SELECT data FROM sessions"):
        try:
            member = json.loads(data).get("member")
        except ValueError:
            continue
        if isinstance(member, dict) and isinstance(member.get("email"), str):
            members.add(member["email"].lower())
    andrew_ids = {r[0].lower() for r in db.execute("SELECT andrew_id FROM profiles")}
    now = int(time.time() * 1000)
    staged = existing = already = 0
    with db:
        db.execute(TABLE)
        for email, payload in accounts.items():
            if email in members or email.split("@")[0] in andrew_ids:
                existing += 1
                continue
            cur = db.execute(
                "INSERT OR IGNORE INTO account_imports(email, payload, staged_at) VALUES (?, ?, ?)",
                (email, json.dumps(payload), now),
            )
            if cur.rowcount:
                staged += 1
            else:
                already += 1
    waiting = db.execute("SELECT count(*) FROM account_imports").fetchone()[0]
    print(f"staged {staged}; skipped {existing} already using this instance, {already} already staged; "
          f"{waiting} waiting for their first sign-in")


if __name__ == "__main__":
    match sys.argv[1:]:
        case ["convert", export_path, catalog_path, out_path]:
            convert(export_path, catalog_path, out_path)
        case ["stage", file_path, db_path]:
            stage(file_path, db_path)
        case _:
            sys.exit(__doc__)
