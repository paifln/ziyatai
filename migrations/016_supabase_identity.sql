-- Provider identity is separate from the stable owner ID used by existing data.
CREATE TABLE auth_identities (
  provider text NOT NULL CHECK (provider = 'supabase'),
  subject uuid NOT NULL,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (provider, owner_id)
);
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX auth_sessions_owner ON auth_sessions(owner_id) WHERE revoked_at IS NULL;
