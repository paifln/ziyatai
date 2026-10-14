-- Projection of immutable row snapshots into SQL DATE fields for querying.
CREATE TABLE ktp_rows (
  version_id uuid NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  row_id uuid NOT NULL,
  source_order integer NOT NULL,
  topic text NOT NULL,
  goal_text text NOT NULL,
  date_raw text NOT NULL,
  date_start date,
  date_end date,
  PRIMARY KEY(version_id,row_id),
  CHECK(date_end IS NULL OR date_start IS NULL OR date_end>=date_start)
);
CREATE INDEX ktp_rows_date ON ktp_rows(version_id,date_start);
CREATE FUNCTION project_ktp_rows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO ktp_rows(version_id,row_id,source_order,topic,goal_text,date_raw,date_start,date_end)
  SELECT NEW.id,(r->>'id')::uuid,(r->>'sourceOrder')::integer,r->>'topic',r->>'goals',r->>'dateRaw',NULLIF(r->>'dateStart','')::date,NULLIF(r->>'dateEnd','')::date
  FROM jsonb_array_elements(NEW.rows) r;
  RETURN NEW;
END $$;
CREATE TRIGGER ktp_rows_projection AFTER INSERT ON plan_versions FOR EACH ROW EXECUTE FUNCTION project_ktp_rows();
INSERT INTO ktp_rows(version_id,row_id,source_order,topic,goal_text,date_raw,date_start,date_end)
SELECT v.id,(r->>'id')::uuid,(r->>'sourceOrder')::integer,r->>'topic',r->>'goals',r->>'dateRaw',NULLIF(r->>'dateStart','')::date,NULLIF(r->>'dateEnd','')::date
FROM plan_versions v CROSS JOIN LATERAL jsonb_array_elements(v.rows) r;
