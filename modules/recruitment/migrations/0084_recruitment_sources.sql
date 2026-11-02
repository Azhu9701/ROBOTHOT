CREATE TABLE IF NOT EXISTS recruitment_sources (
 company text PRIMARY KEY,
 company_url text NOT NULL,
 official_url text,
 career_url text,
 provider text,
 endpoint text,
 status text NOT NULL DEFAULT 'pending',
 evidence jsonb NOT NULL DEFAULT '{}',
 catalog_seen_at timestamptz NOT NULL DEFAULT now(),
 discovered_at timestamptz,
 attempted_at timestamptz,
 last_success timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
