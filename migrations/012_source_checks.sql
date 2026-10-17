ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('import','generate','regenerate','export','delete','scan'));
CREATE INDEX jobs_source_checks ON jobs(owner_id,(payload->>'uploadId'),created_at DESC) WHERE kind='scan';
