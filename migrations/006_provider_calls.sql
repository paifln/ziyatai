ALTER TABLE jobs ADD COLUMN provider_calls integer NOT NULL DEFAULT 0 CHECK(provider_calls>=0);
