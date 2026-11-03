-- Logical bytes, including reservations and tombstones, are charged until deletion.
-- Existing data is retained even when already above the 1 GiB account budget.
CREATE TABLE resource_budgets (
  owner_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  bytes bigint NOT NULL DEFAULT 0 CHECK(bytes >= 0)
);
ALTER TABLE exports ADD COLUMN budget_bytes bigint NOT NULL DEFAULT 33554432 CHECK(budget_bytes BETWEEN 0 AND 33554432);
ALTER TABLE plan_versions ADD COLUMN budget_owner_id text;
ALTER TABLE generation_versions ADD COLUMN budget_owner_id text;
UPDATE plan_versions v SET budget_owner_id=p.owner_id FROM plans p WHERE p.id=v.plan_id;
UPDATE generation_versions v SET budget_owner_id=g.owner_id FROM generations g WHERE g.id=v.generation_id;
ALTER TABLE plan_versions ALTER COLUMN budget_owner_id SET NOT NULL;
ALTER TABLE generation_versions ALTER COLUMN budget_owner_id SET NOT NULL;

CREATE FUNCTION resource_size(value jsonb, kind text) RETURNS bigint
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN kind='uploads' THEN (value->>'bytes')::bigint
             WHEN kind='exports' THEN (value->>'budget_bytes')::bigint
             ELSE octet_length((value - 'budget_owner_id')::text)::bigint END
$$;
INSERT INTO resource_budgets(owner_id,bytes)
SELECT owner_id,sum(bytes) FROM (
 SELECT owner_id,bytes FROM uploads
 UNION ALL SELECT owner_id,budget_bytes FROM exports
 UNION ALL SELECT budget_owner_id,resource_size(to_jsonb(v),'plan_versions') FROM plan_versions v
 UNION ALL SELECT budget_owner_id,resource_size(to_jsonb(v),'generation_versions') FROM generation_versions v
) usage GROUP BY owner_id;

CREATE FUNCTION version_budget_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='plan_versions' THEN
  SELECT owner_id INTO NEW.budget_owner_id FROM plans WHERE id=NEW.plan_id;
 ELSE
  SELECT owner_id INTO NEW.budget_owner_id FROM generations WHERE id=NEW.generation_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER plan_version_budget_owner BEFORE INSERT ON plan_versions FOR EACH ROW EXECUTE FUNCTION version_budget_owner();
CREATE TRIGGER generation_version_budget_owner BEFORE INSERT ON generation_versions FOR EACH ROW EXECUTE FUNCTION version_budget_owner();
CREATE FUNCTION account_resource_budget() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner text; previous_owner text; before_bytes bigint:=0; after_bytes bigint:=0;
        parent uuid; versions integer;
BEGIN
 IF TG_OP <> 'DELETE' THEN
  IF TG_TABLE_NAME='plan_versions' THEN
   SELECT owner_id INTO NEW.budget_owner_id FROM plans WHERE id=NEW.plan_id;
   parent:=NEW.plan_id;
  ELSIF TG_TABLE_NAME='generation_versions' THEN
   SELECT owner_id INTO NEW.budget_owner_id FROM generations WHERE id=NEW.generation_id;
   parent:=NEW.generation_id;
  END IF;
  owner:=COALESCE(to_jsonb(NEW)->>'owner_id',to_jsonb(NEW)->>'budget_owner_id');
  after_bytes:=resource_size(to_jsonb(NEW),TG_TABLE_NAME);
 END IF;
 IF TG_OP <> 'INSERT' THEN
  previous_owner:=COALESCE(to_jsonb(OLD)->>'owner_id',to_jsonb(OLD)->>'budget_owner_id');
  before_bytes:=resource_size(to_jsonb(OLD),TG_TABLE_NAME);
  IF owner IS NOT NULL AND owner<>previous_owner THEN
   RAISE EXCEPTION 'RESOURCE_OWNER_IMMUTABLE';
  END IF;
 END IF;
 owner:=COALESCE(owner,previous_owner);
 IF TG_OP='INSERT' AND parent IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(parent::text,843003));
  IF TG_TABLE_NAME='plan_versions' THEN
   SELECT count(*) INTO versions FROM plan_versions WHERE plan_id=parent;
  ELSE
   SELECT count(*) INTO versions FROM generation_versions WHERE generation_id=parent;
  END IF;
  IF versions>200 THEN RAISE EXCEPTION 'RESOURCE_LIMIT'; END IF;
 END IF;
 IF after_bytes>before_bytes THEN
  INSERT INTO resource_budgets(owner_id,bytes) VALUES(owner,0) ON CONFLICT DO NOTHING;
  UPDATE resource_budgets SET bytes=bytes+after_bytes-before_bytes
   WHERE owner_id=owner AND bytes+after_bytes-before_bytes<=1073741824;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESOURCE_LIMIT'; END IF;
 ELSIF after_bytes<before_bytes THEN
  -- An account cascade may already have removed its budget row.
  UPDATE resource_budgets SET bytes=GREATEST(0,bytes+after_bytes-before_bytes) WHERE owner_id=owner;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER uploads_resource_budget AFTER INSERT OR UPDATE OR DELETE ON uploads FOR EACH ROW EXECUTE FUNCTION account_resource_budget();
CREATE TRIGGER exports_resource_budget AFTER INSERT OR UPDATE OR DELETE ON exports FOR EACH ROW EXECUTE FUNCTION account_resource_budget();
CREATE TRIGGER plan_versions_resource_budget AFTER INSERT OR UPDATE OR DELETE ON plan_versions FOR EACH ROW EXECUTE FUNCTION account_resource_budget();
CREATE TRIGGER generation_versions_resource_budget AFTER INSERT OR UPDATE OR DELETE ON generation_versions FOR EACH ROW EXECUTE FUNCTION account_resource_budget();
REVOKE ALL ON FUNCTION resource_size(jsonb,text), account_resource_budget(), version_budget_owner() FROM PUBLIC;
