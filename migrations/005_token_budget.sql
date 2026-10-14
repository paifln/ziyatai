ALTER TABLE usage_ledger ADD COLUMN reserved_tokens integer NOT NULL DEFAULT 0 CHECK(reserved_tokens>=0);
