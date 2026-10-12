CREATE FUNCTION app_current_tenant_id() RETURNS UUID
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::UUID $$;

CREATE FUNCTION app_rls_bypassed() RETURNS BOOLEAN
LANGUAGE sql STABLE
AS $$ SELECT COALESCE(current_setting('app.bypass_rls', true), '') = 'on' $$;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tenants"
  USING (app_rls_bypassed() OR "id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "id" = app_current_tenant_id());

ALTER TABLE "tenant_brandings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_brandings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tenant_brandings"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "units" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "units"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "roles"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "memberships"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "membership_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_units" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "membership_units"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_logs"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());
