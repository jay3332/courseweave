//! `data/terms.json`: the terms to build, their dates and minis, and the sources each is built from (Courseweave's
//! `data/terms.json`, with paths relative to the exported root).

use std::path::Path;

use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::model::{DateRange, MiniMeta, TermMeta};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TermConfig {
    pub id: String,
    pub name: String,
    pub season: String,
    pub year: i64,
    pub minis: Vec<MiniMeta>,
    pub classes_begin: String,
    pub classes_end: String,
    pub no_classes: Vec<DateRange>,
    #[serde(default)]
    pub notes: Option<Vec<String>>,
    pub sources: Vec<SourceConfig>,
}

/// One entry of a term's `sources`. The first source is primary: it defines the course list. Later ones are
/// supplements, which add missing sections and fill gaps but never remove anything.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceConfig {
    /// `soc`, `csv` or `stellic`.
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub role: Option<String>,
    /// Supplements only: also add courses the primary doesn't list. Default false.
    #[serde(default)]
    pub add_missing_courses: Option<bool>,
    /// Supplements only: add sections the primary doesn't list. Default true; false when the primary is
    /// authoritative about which sections exist (the SOC drops cancelled sections).
    #[serde(default)]
    pub add_missing_sections: Option<bool>,
    /// Supplements only: add meetings at times a section's primary meetings don't list. Default
    /// `add_missing_sections`: a primary authoritative about which sections exist is also authoritative about when
    /// they meet, and a supplement's other times are stale or the same meetings split by day.
    #[serde(default)]
    pub add_missing_meetings: Option<bool>,
    /// Adapter options.
    #[serde(flatten)]
    pub options: Map<String, Value>,
}

impl SourceConfig {
    pub fn str(&self, key: &str) -> Option<&str> {
        self.options.get(key).and_then(Value::as_str)
    }

    /// JavaScript truthiness of an option.
    pub fn truthy(&self, key: &str) -> bool {
        match self.options.get(key) {
            None | Some(Value::Null) => false,
            Some(Value::Bool(b)) => *b,
            Some(Value::Number(n)) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
            Some(Value::String(s)) => !s.is_empty(),
            Some(_) => true,
        }
    }
}

impl TermConfig {
    /// The term's metadata before its sources are known.
    pub fn meta(&self) -> TermMeta {
        TermMeta {
            id: self.id.clone(),
            name: self.name.clone(),
            season: self.season.clone(),
            year: self.year,
            minis: self.minis.clone(),
            classes_begin: self.classes_begin.clone(),
            classes_end: self.classes_end.clone(),
            no_classes: self.no_classes.clone(),
            notes: self.notes.clone(),
            sources: self.sources.iter().map(|s| s.kind.clone()).collect(),
        }
    }
}

pub fn read_terms(path: &Path) -> Result<Vec<TermConfig>> {
    let text =
        std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
    let terms: Vec<TermConfig> =
        serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))?;
    for t in &terms {
        if !matches!(t.season.as_str(), "spring" | "summer" | "fall") {
            bail!("{}: unknown season {:?}", t.id, t.season);
        }
        if t.sources.is_empty() {
            bail!("{}: no sources", t.id);
        }
    }
    Ok(terms)
}
