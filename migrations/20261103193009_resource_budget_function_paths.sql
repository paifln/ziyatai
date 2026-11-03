-- Table triggers must resolve their private tables independently of the caller.
DO $$
DECLARE namespace text := current_schema();
BEGIN
 EXECUTE format('ALTER FUNCTION %I.account_resource_budget() SET search_path = %I, pg_catalog, pg_temp',namespace,namespace);
 EXECUTE format('ALTER FUNCTION %I.version_budget_owner() SET search_path = %I, pg_catalog, pg_temp',namespace,namespace);
 EXECUTE format('ALTER FUNCTION %I.resource_size(jsonb,text) SET search_path = %I, pg_catalog, pg_temp',namespace,namespace);
END $$;
