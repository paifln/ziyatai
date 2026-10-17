-- Anonymous and authenticated session lookups share a network budget.
-- Keys are purpose-separated HMACs; no IP, cookie or account identifier is stored.
CREATE TABLE auth_session_read_budgets (
  key text PRIMARY KEY CHECK (key ~ '^[a-f0-9]{64}$'),
  available_at timestamptz NOT NULL
);
CREATE INDEX auth_session_read_budgets_expiry ON auth_session_read_budgets(available_at,key);
