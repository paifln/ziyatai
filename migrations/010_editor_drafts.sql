CREATE TABLE editor_drafts (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES plans(id) ON DELETE CASCADE,
  generation_id uuid REFERENCES generations(id) ON DELETE CASCADE,
  base_revision integer NOT NULL CHECK (base_revision > 0),
  sequence integer NOT NULL CHECK (sequence >= 0),
  payload jsonb,
  saved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  discarded_at timestamptz,
  CHECK (num_nonnulls(plan_id, generation_id) = 1),
  CHECK ((payload IS NOT NULL) = (discarded_at IS NULL)),
  CHECK (payload IS NULL OR octet_length(payload::text) <= 3145728)
);
CREATE INDEX editor_drafts_owner ON editor_drafts(owner_id, saved_at DESC);
CREATE INDEX editor_drafts_expiry ON editor_drafts(expires_at);
