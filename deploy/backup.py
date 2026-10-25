#!/usr/bin/env python3
"""Copies the user database to backups/users-YYYY-MM-DD.sqlite and keeps the latest 14. SQLite's backup API copies
it consistently while the server keeps running."""
import datetime
import pathlib
import sqlite3

home = pathlib.Path(__file__).resolve().parent
source = home / "data" / "users.sqlite"
backups = home / "backups"
backups.mkdir(exist_ok=True)
if source.exists():
    target = backups / f"users-{datetime.date.today():%Y-%m-%d}.sqlite"
    src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    dst = sqlite3.connect(target)
    with dst:
        src.backup(dst)
    src.close()
    dst.close()
for old in sorted(backups.glob("users-*.sqlite"))[:-14]:
    old.unlink()
