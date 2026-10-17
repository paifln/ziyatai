-- At most four rows per account. Resource IDs and caller-supplied IPs are not keys.
CREATE TABLE api_read_budgets (
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  bucket text NOT NULL CHECK (bucket IN ('metadata','snapshot','download','preview')),
  available_at timestamptz NOT NULL,
  PRIMARY KEY(owner_id,bucket)
);
