CREATE TABLE "tenant_integrations" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_integrations_pkey" PRIMARY KEY ("tenant_id","key")
);

ALTER TABLE "tenant_integrations" ADD CONSTRAINT "tenant_integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_integrations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tenant_integrations"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());
