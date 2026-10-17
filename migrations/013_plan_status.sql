ALTER TABLE plans ADD CONSTRAINT plans_status_check
  CHECK(status IN ('extracting','review','confirmed','failed','cancelled'));
