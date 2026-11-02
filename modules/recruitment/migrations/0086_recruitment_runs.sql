CREATE TABLE IF NOT EXISTS recruitment_runs (
 id bigserial PRIMARY KEY,
 company text NOT NULL,
 outcome text NOT NULL,
 job_count integer,
 complete boolean NOT NULL,
 evidence_hash text,
 error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
