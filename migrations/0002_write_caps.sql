-- Per-document daily write counter, so one account can't spend the database's daily write budget.
-- `day` is the UTC day number (ms since epoch / 86400000) of the last write; `day_writes` counts writes that day.
-- Both are updated in the same statement as the document itself, so the cap costs no extra writes.
ALTER TABLE docs ADD COLUMN day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE docs ADD COLUMN day_writes INTEGER NOT NULL DEFAULT 0;
