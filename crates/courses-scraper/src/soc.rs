//! `--mode soc`: captures CMU's public Schedule of Classes (SOC) for the catalog builder, as Courseweave's
//! `scripts/fetch-soc.ts` and `build-catalog.ts --fetch` do. Requests are serial with a delay.
//!
//! Per term, under `<export_root>/soc/<term>/`:
//! - `search-U.html.gz`, `search-G.html.gz`: the undergraduate and graduate search results, which together are the
//!   full schedule and tell each course's level
//! - `details.json.gz`: `{ courseId: courseDetails page }` for courses whose lecture to section grouping the flat
//!   listing can't show (several lectures plus other sections); `--soc-details all` fetches every course
//! - `extras.json`: `{ courseId: { reservations?, permission? } }` from each course's detail page. For the current
//!   and upcoming terms a run reads courses it hasn't yet plus a rotating slice of the rest; past terms are read once
//! - `meta.json`: fetch time, the SOC's label for the term, department codes
//!
//! With `--soc-catalog`, also `<export_root>/soc/details.json`: each course's detail page, parsed, for the catalog's
//! descriptions and requisite text. Courses already there are kept.
//!
//! Pages are Latin-1. They're stored as UTF-8 text, one character per byte, as Courseweave stores them, so the
//! builder reads them back the same way.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use courses_index::js::{self, Object};
use courses_index::soc::{
    SelectOption, SocDetailsCache, ambiguous_courses, parse_dat, parse_details_extras,
    parse_search_page, parse_soc_detail, response_text, select_options,
};
use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

const BASE: &str = "https://enr-apps.as.cmu.edu";
const SERVLET: &str = "https://enr-apps.as.cmu.edu/open/SOC/SOCServlet";
const USER_AGENT: &str = "cmu-courses-scraper (ScottyLabs; https://cmu.courses)";
const BODY_LIMIT: u64 = 64 << 20;

/// Courses re-read per term and run, besides ones never read.
const EXTRAS_SLICE: usize = 900;
/// At most this many per term and run, never-read ones first, so a newly published term fits a run.
const EXTRAS_MAX: usize = 1500;
/// Past terms' backfill per term and run.
const EXTRAS_BACKFILL: usize = 1200;
/// Runs are twice a week.
const RUN_SPACING_MS: u64 = 302_400_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum DetailsMode {
    Ambiguous,
    All,
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum ExtrasMode {
    Rotate,
    All,
    None,
}

pub struct Options {
    pub export_root: PathBuf,
    /// Terms to capture; empty for every term the SOC offers.
    pub terms: Vec<String>,
    pub details: DetailsMode,
    pub extras: ExtrasMode,
    /// Also refresh `soc/details.json` for the catalog.
    pub catalog: bool,
    /// Only this department, for trying the scraper out.
    pub dept: Option<String>,
    pub delay: Duration,
}

struct Client {
    agent: ureq::Agent,
    delay: Duration,
}

impl Client {
    fn new(delay: Duration) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(180)))
            .user_agent(USER_AGENT)
            .http_status_as_error(false)
            .build()
            .into();
        Self { agent, delay }
    }

    /// Status and text (by the declared charset), retrying network errors and server errors twice. Waits the delay
    /// after each request.
    fn request(
        &self,
        send: impl Fn(&ureq::Agent) -> Result<ureq::http::Response<ureq::Body>, ureq::Error>,
    ) -> Result<(u16, String)> {
        let mut attempt = 1;
        loop {
            let result = send(&self.agent)
                .map_err(anyhow::Error::from)
                .and_then(|res| {
                    let status = res.status().as_u16();
                    let content_type = res
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .map(str::to_owned);
                    let bytes = res
                        .into_body()
                        .into_with_config()
                        .limit(BODY_LIMIT)
                        .read_to_vec()?;
                    Ok((status, response_text(&bytes, content_type.as_deref())))
                });
            std::thread::sleep(self.delay);
            match result {
                Ok((status, _)) if status >= 500 && attempt < 3 => {}
                Ok(ok) => return Ok(ok),
                Err(e) if attempt >= 3 => return Err(e),
                Err(_) => {}
            }
            std::thread::sleep(Duration::from_secs(attempt));
            attempt += 1;
        }
    }

    fn get(&self, url: &str) -> Result<(u16, String)> {
        self.request(|a| a.get(url).call())
    }

    fn get_ok(&self, url: &str) -> Result<String> {
        let (status, text) = self.get(url)?;
        if status != 200 {
            bail!("HTTP {status} for {url}");
        }
        Ok(text)
    }

    fn search(&self, term: &str, level: &str, dept: Option<&str>) -> Result<String> {
        let dept = dept.unwrap_or("All");
        let form = [
            ("SEMESTER", term),
            ("MINI", "NO"),
            ("GRAD_UNDER", level),
            ("PRG_LOCATION", "All"),
            ("DEPT", dept),
            ("COURSE", ""),
            ("TITLE", ""),
            ("BEG_TIME", "All"),
            ("KEYWORD", ""),
            ("TITLE_ONLY", "NO"),
            ("SUBMIT", ""),
        ];
        let url = format!("{SERVLET}/search");
        let (status, text) = self.request(|a| a.post(&url).send_form(form))?;
        if status != 200 {
            bail!("HTTP {status} searching {term} {level}");
        }
        Ok(text)
    }

    fn course_details(&self, course: &str, term: &str) -> Result<(u16, String)> {
        self.get(&format!(
            "{SERVLET}/courseDetails?COURSE={course}&SEMESTER={term}"
        ))
    }
}

fn gzip(text: &str) -> Result<Vec<u8>> {
    let mut e = GzEncoder::new(Vec::new(), Compression::default());
    e.write_all(text.as_bytes())?;
    Ok(e.finish()?)
}

fn gunzip(bytes: &[u8]) -> Result<String> {
    let mut out = String::new();
    GzDecoder::new(bytes).read_to_string(&mut out)?;
    Ok(out)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// A term's position in time: later terms are larger.
fn ordinal(term: &str) -> i64 {
    let season = match term.as_bytes().first() {
        Some(b'S') => 0,
        Some(b'M') => 1,
        _ => 2,
    };
    term.get(1..)
        .and_then(|y| y.parse::<i64>().ok())
        .unwrap_or(0)
        * 3
        + season
}

/// The term under way, or next to start: spring through May, summer through August, then fall.
fn current_term(millis: u64) -> String {
    let (year, month, _) = js::civil_from_days((millis / 86_400_000) as i64);
    let season = match month {
        1..=5 => 'S',
        6..=8 => 'M',
        _ => 'F',
    };
    format!("{season}{:02}", year.rem_euclid(100))
}

/// A course's reservations and special permission, from its detail page.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Extras {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reservations: Option<Object<Vec<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    permission: Option<bool>,
}

/// One course per line, sorted, so a refresh's diff shows which courses' reservations changed.
fn write_extras(path: &Path, extras: &BTreeMap<String, Extras>) -> Result<()> {
    let lines: Vec<String> = extras
        .iter()
        .map(|(id, e)| {
            Ok(format!(
                "  {}: {}",
                serde_json::to_string(id)?,
                serde_json::to_string(e)?
            ))
        })
        .collect::<Result<_>>()?;
    std::fs::write(path, format!("{{\n{}\n}}\n", lines.join(",\n")))?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Meta<'a> {
    term: &'a str,
    label: Option<&'a str>,
    fetched_at: String,
    details_mode: &'a str,
    departments: Vec<Department>,
}

#[derive(Serialize)]
struct Department {
    code: String,
    name: String,
    prefix: Option<String>,
}

fn department(o: &SelectOption) -> Department {
    // `Computer Science (15XXX)`
    static PREFIX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\(([0-9]{2})XXX\)").unwrap());
    static SUFFIX: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(&format!(r"{ws}*\([0-9]{{2}}XXX\){ws}*$", ws = js::WS)).unwrap()
    });
    Department {
        code: o.value.clone(),
        name: SUFFIX.replace(&o.label, "").into_owned(),
        prefix: PREFIX.captures(&o.label).map(|c| c[1].to_owned()),
    }
}

pub fn run(opts: &Options) -> Result<()> {
    let client = Client::new(opts.delay);
    let landing = client.get_ok(&format!("{SERVLET}/search"))?;
    let semesters = select_options(&landing, "SEMESTER");
    let departments: Vec<Department> = select_options(&landing, "DEPT")
        .iter()
        .filter(|o| o.value != "All")
        .map(department)
        .collect();
    info!(
        offered = %semesters.iter().map(|s| format!("{} ({})", s.value, s.label)).collect::<Vec<_>>().join(", "),
        "SOC terms"
    );
    let terms: Vec<String> = if opts.terms.is_empty() {
        semesters.iter().map(|s| s.value.clone()).collect()
    } else {
        opts.terms.clone()
    };
    for term in &terms {
        capture_term(&client, opts, term, &semesters, &departments)
            .with_context(|| format!("capturing {term}"))?;
    }
    if opts.catalog {
        let available: Vec<String> = semesters.iter().map(|s| s.value.clone()).collect();
        refresh_catalog(&client, opts, &available)?;
    }
    Ok(())
}

fn capture_term(
    client: &Client,
    opts: &Options,
    term: &str,
    semesters: &[SelectOption],
    departments: &[Department],
) -> Result<()> {
    let label = semesters
        .iter()
        .find(|s| s.value == term)
        .map(|s| s.label.as_str());
    if label.is_none() {
        warn!(term, "not in the SOC's term list; trying anyway");
    }
    let dir = opts.export_root.join("soc").join(term);
    std::fs::create_dir_all(&dir)?;

    let mut rows = Vec::new();
    for level in ["U", "G"] {
        let page = client.search(term, level, opts.dept.as_deref())?;
        std::fs::write(dir.join(format!("search-{level}.html.gz")), gzip(&page)?)?;
        let parsed = parse_search_page(&page);
        info!(
            term,
            level,
            courses = parsed.iter().filter(|r| !r.course.is_empty()).count(),
            "search"
        );
        rows.push(parsed);
    }
    let all: BTreeSet<String> = rows
        .iter()
        .flatten()
        .filter(|r| !r.course.is_empty())
        .map(|r| r.course.clone())
        .collect();

    let details_path = dir.join("details.json.gz");
    let mut details: BTreeMap<String, String> = if details_path.exists() {
        serde_json::from_str(&gunzip(&std::fs::read(&details_path)?)?)?
    } else {
        BTreeMap::new()
    };
    let mut fresh: HashSet<String> = HashSet::new();
    if opts.details != DetailsMode::None {
        let wanted: Vec<String> = match opts.details {
            DetailsMode::All => all.iter().cloned().collect(),
            _ => rows.iter().flat_map(|r| ambiguous_courses(r)).collect(),
        };
        for (n, course) in wanted.iter().enumerate() {
            match client.course_details(course, term) {
                Ok((200, html)) => {
                    details.insert(course.clone(), html);
                    fresh.insert(course.clone());
                }
                Ok((status, _)) => warn!(term, course, status, "course details"),
                Err(e) => warn!(term, course, error = %e, "course details"),
            }
            if (n + 1) % 50 == 0 {
                info!(term, done = n + 1, total = wanted.len(), "details");
            }
        }
    }
    let ordered: Object<&String> = details.iter().map(|(k, v)| (k.clone(), v)).collect();
    std::fs::write(&details_path, gzip(&serde_json::to_string(&ordered)?)?)?;

    if opts.extras != ExtrasMode::None {
        let extras_path = dir.join("extras.json");
        let old: BTreeMap<String, Extras> = if extras_path.exists() {
            serde_json::from_slice(&std::fs::read(&extras_path)?)?
        } else {
            BTreeMap::new()
        };
        let mut extras: BTreeMap<String, Extras> = all
            .iter()
            .filter_map(|id| Some((id.clone(), old.get(id)?.clone())))
            .collect();
        let unread: Vec<&String> = all.iter().filter(|id| !old.contains_key(*id)).collect();
        let now = now_millis();
        let past = ordinal(term) < ordinal(&current_term(now));
        let all_list: Vec<&String> = all.iter().collect();
        let wanted: Vec<&String> = match opts.extras {
            ExtrasMode::Rotate if past => unread.into_iter().take(EXTRAS_BACKFILL).collect(),
            ExtrasMode::Rotate => {
                let slices = all_list.len().div_ceil(EXTRAS_SLICE).max(1);
                let at = ((now / RUN_SPACING_MS) as usize % slices) * EXTRAS_SLICE;
                let mut seen = HashSet::new();
                unread
                    .into_iter()
                    .chain(all_list.iter().skip(at).take(EXTRAS_SLICE).copied())
                    .filter(|id| seen.insert(*id))
                    .take(EXTRAS_MAX)
                    .collect()
            }
            _ => all_list,
        };
        for (n, course) in wanted.iter().enumerate() {
            let html = if fresh.contains(*course) {
                Ok((200, details[*course].clone()))
            } else {
                client.course_details(course, term)
            };
            match html {
                Ok((200, html)) => {
                    let parsed = parse_details_extras(&html);
                    let reservations: Object<Vec<String>> =
                        parsed.reservations.into_iter().collect();
                    extras.insert(
                        (*course).clone(),
                        Extras {
                            reservations: (!reservations.is_empty()).then_some(reservations),
                            permission: parsed.permission.filter(|p| *p),
                        },
                    );
                }
                Ok((status, _)) => warn!(term, course = %course, status, "reservations"),
                Err(e) => warn!(term, course = %course, error = %e, "reservations"),
            }
            if (n + 1) % 100 == 0 {
                info!(term, done = n + 1, total = wanted.len(), "reservations");
            }
        }
        write_extras(&extras_path, &extras)?;
        info!(
            term,
            read = wanted.len(),
            courses = all.len(),
            with_reservations = extras.values().filter(|e| e.reservations.is_some()).count(),
            "reservations"
        );
    }

    let meta = Meta {
        term,
        label,
        fetched_at: js::iso_from_unix_millis(now_millis() as i64),
        details_mode: match opts.details {
            DetailsMode::Ambiguous => "ambiguous",
            DetailsMode::All => "all",
            DetailsMode::None => "none",
        },
        departments: departments
            .iter()
            .map(|d| Department {
                code: d.code.clone(),
                name: d.name.clone(),
                prefix: d.prefix.clone(),
            })
            .collect(),
    };
    std::fs::write(
        dir.join("meta.json"),
        serde_json::to_string_pretty(&meta)? + "\n",
    )?;
    Ok(())
}

#[derive(Deserialize)]
struct StellicInfo {
    #[serde(default)]
    offerings: Option<Vec<StellicOffering>>,
}

#[derive(Deserialize)]
struct StellicOffering {
    campus_id: Option<i64>,
    #[serde(default)]
    semesters: Vec<StellicSemester>,
}

#[derive(Deserialize)]
struct StellicSemester {
    semester: i64,
    year: i64,
}

/// Terms (`F25`) a course was offered in at the Pittsburgh campus, newest first, per Stellic.
fn stellic_terms(info: &StellicInfo) -> Vec<String> {
    let mut out: Vec<(String, i64)> = Vec::new();
    for o in info
        .offerings
        .iter()
        .flatten()
        .filter(|o| o.campus_id == Some(1))
    {
        for s in &o.semesters {
            let (letter, order) = match s.semester {
                1 => ('F', 3),
                2 => ('S', 1),
                3 => ('M', 2),
                _ => continue,
            };
            out.push((
                format!("{letter}{:02}", s.year.rem_euclid(100)),
                s.year * 10 + order,
            ));
        }
    }
    out.sort_by_key(|t| std::cmp::Reverse(t.1));
    out.into_iter().map(|(t, _)| t).collect()
}

/// Every Stellic export's course info, for the terms each course was offered in.
fn stellic_infos(export_root: &Path) -> Result<BTreeMap<String, StellicInfo>> {
    let mut out = BTreeMap::new();
    let Ok(users) = std::fs::read_dir(export_root) else {
        return Ok(out);
    };
    for user in users.filter_map(|e| e.ok()) {
        let hist = user.path().join("courses_history");
        let Ok(courses) = std::fs::read_dir(&hist) else {
            continue;
        };
        for course in courses.filter_map(|e| e.ok()) {
            let id = course.file_name().to_string_lossy().into_owned();
            let path = course.path().join("info.json");
            if id.len() != 5 || !id.bytes().all(|b| b.is_ascii_digit()) || !path.exists() {
                continue;
            }
            let info = serde_json::from_slice(&std::fs::read(&path)?)
                .with_context(|| format!("parsing {}", path.display()))?;
            out.insert(id, info);
        }
    }
    Ok(out)
}

/// Fetches the detail page of every course listed in a SOC term or offered in one per Stellic, unless it's cached.
fn refresh_catalog(client: &Client, opts: &Options, available: &[String]) -> Result<()> {
    let path = opts.export_root.join("soc").join("details.json");
    let mut cache: SocDetailsCache = if path.exists() {
        serde_json::from_slice(&std::fs::read(&path)?)?
    } else {
        SocDetailsCache::default()
    };

    // Course lists of the current fall and spring dumps; Stellic's offerings cover the rest.
    let mut listed: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for season in ["fall", "spring"] {
        let (status, text) = client.get(&format!("{BASE}/assets/SOC/sched_layout_{season}.dat"))?;
        if status != 200 {
            continue;
        }
        let (Some(term), ids) = parse_dat(&text) else {
            continue;
        };
        if !available.contains(&term) {
            continue;
        }
        for id in ids {
            listed.entry(id).or_default().push(term.clone());
        }
    }
    for (id, info) in stellic_infos(&opts.export_root)? {
        let terms: Vec<String> = stellic_terms(&info)
            .into_iter()
            .filter(|t| available.contains(t))
            .collect();
        if !terms.is_empty() {
            let list = listed.entry(id).or_default();
            for t in terms {
                if !list.contains(&t) {
                    list.push(t);
                }
            }
        }
    }
    if let Some(dept) = &opts.dept {
        // A department's courses are the ones its searches listed.
        let mut ids: HashSet<String> = HashSet::new();
        for term in available {
            let dir = opts.export_root.join("soc").join(term);
            for level in ["U", "G"] {
                if let Ok(bytes) = std::fs::read(dir.join(format!("search-{level}.html.gz"))) {
                    ids.extend(
                        parse_search_page(&gunzip(&bytes)?)
                            .into_iter()
                            .map(|r| r.course),
                    );
                }
            }
        }
        listed.retain(|id, _| ids.contains(id));
        info!(
            dept,
            courses = listed.len(),
            "catalog details limited to the department"
        );
    }

    let mut missing: BTreeSet<String> = cache.missing.iter().cloned().collect();
    let todo: Vec<(&String, &Vec<String>)> = listed
        .iter()
        .filter(|(id, _)| !cache.courses.contains_key(*id) && !missing.contains(*id))
        .collect();
    info!(
        todo = todo.len(),
        cached = cache.courses.len(),
        "catalog details"
    );
    let save = |cache: &SocDetailsCache| -> Result<()> {
        std::fs::write(&path, serde_json::to_vec(cache)?)?;
        Ok(())
    };
    for (n, (id, terms)) in todo.iter().enumerate() {
        for term in *terms {
            match client.course_details(id, term) {
                Ok((200, html)) if html.contains("course-detail-modal-body") => {
                    cache
                        .courses
                        .insert((*id).clone(), parse_soc_detail(&html, term));
                    break;
                }
                Ok(_) => {}
                Err(e) => warn!(course = %id, term = %term, error = %e, "course details"),
            }
        }
        if !cache.courses.contains_key(*id) {
            missing.insert((*id).clone());
        }
        if (n + 1) % 250 == 0 {
            info!(done = n + 1, total = todo.len(), "catalog details");
            cache.missing = missing.iter().cloned().collect();
            save(&cache)?;
        }
    }
    cache.fetched_at = js::iso_from_unix_millis(now_millis() as i64);
    cache.missing = missing.into_iter().collect();
    std::fs::create_dir_all(path.parent().unwrap())?;
    save(&cache)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn departments_from_labels() {
        let d = department(&SelectOption {
            value: "CS".into(),
            label: "Computer Science (15XXX)".into(),
        });
        assert_eq!(
            (d.code.as_str(), d.name.as_str(), d.prefix.as_deref()),
            ("CS", "Computer Science", Some("15"))
        );
        let d = department(&SelectOption {
            value: "MCS".into(),
            label: "MCS Interdisciplinary".into(),
        });
        assert_eq!((d.name.as_str(), d.prefix), ("MCS Interdisciplinary", None));
        let d = department(&SelectOption {
            value: "STU".into(),
            label: "StuCo (Student Led Courses) (98XXX)".into(),
        });
        assert_eq!(
            (d.name.as_str(), d.prefix.as_deref()),
            ("StuCo (Student Led Courses)", Some("98"))
        );
    }

    #[test]
    fn terms_in_time() {
        assert!(
            ordinal("S26") < ordinal("M26")
                && ordinal("M26") < ordinal("F26")
                && ordinal("F26") < ordinal("S27")
        );
        // 2026-10-24 is during the fall.
        assert_eq!(current_term(1_792_800_000_000), "F26");
        assert_eq!(current_term(1_767_225_600_000), "S26");
    }

    #[test]
    fn stellic_offerings_newest_first() {
        let info: StellicInfo = serde_json::from_str(
            r#"{"offerings":[{"campus_id":1,"semesters":[{"semester":2,"year":2026},{"semester":1,"year":2026},{"semester":3,"year":2026}]},
                {"campus_id":2,"semesters":[{"semester":1,"year":2027}]}]}"#,
        )
        .unwrap();
        assert_eq!(stellic_terms(&info), ["F26", "M26", "S26"]);
    }

    /// Rewriting a captured `extras.json` gives the same bytes. `EXPORTED_ROOT` is a scraper output root with SOC
    /// captures, such as Courseweave's.
    #[test]
    #[ignore = "needs SOC captures"]
    fn rewrites_captured_extras_unchanged() {
        let root = PathBuf::from(std::env::var_os("EXPORTED_ROOT").expect("set EXPORTED_ROOT"));
        let out = tempfile::tempdir().unwrap();
        let mut checked = 0;
        for term in std::fs::read_dir(root.join("soc")).unwrap() {
            let path = term.unwrap().path().join("extras.json");
            if !path.exists() {
                continue;
            }
            let original = std::fs::read(&path).unwrap();
            let extras: BTreeMap<String, Extras> = serde_json::from_slice(&original).unwrap();
            let copy = out.path().join("extras.json");
            write_extras(&copy, &extras).unwrap();
            assert_eq!(
                std::fs::read(&copy).unwrap(),
                original,
                "{}",
                path.display()
            );
            checked += 1;
        }
        assert!(checked > 0);
    }

    #[test]
    fn extras_file_format() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("extras.json");
        let old = r#"{
  "02120": {"reservations":{"B":["x"],"A":["y"]}},
  "15122": {"permission":true}
}
"#;
        std::fs::write(&path, old).unwrap();
        let extras: BTreeMap<String, Extras> =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        write_extras(&path, &extras).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), old);
        write_extras(&path, &BTreeMap::new()).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\n\n}\n");
    }
}
