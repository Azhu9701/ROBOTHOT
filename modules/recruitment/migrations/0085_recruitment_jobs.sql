CREATE TABLE IF NOT EXISTS recruitment_jobs (
 company text NOT NULL,
 url text NOT NULL,
 details jsonb NOT NULL,
 first_seen timestamptz NOT NULL DEFAULT now(),
 last_seen timestamptz NOT NULL DEFAULT now(),
 missing_since timestamptz,
 baseline boolean NOT NULL,
 evidence_hash text NOT NULL,
 PRIMARY KEY (company, url)
);
