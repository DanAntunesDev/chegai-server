CREATE TABLE "service_combo_items" (
    "combo_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "service_combo_items_pkey" PRIMARY KEY ("combo_id","service_id"),
    CONSTRAINT "service_combo_items_distinct_check" CHECK ("combo_id" <> "service_id")
);

CREATE INDEX "service_combo_items_tenant_id_idx" ON "service_combo_items"("tenant_id");

ALTER TABLE "service_combo_items" ADD CONSTRAINT "service_combo_items_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_combo_items" ADD CONSTRAINT "service_combo_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_combo_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_combo_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "service_combo_items"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());


ALTER TABLE "customers" ADD COLUMN "password_hash" TEXT;
ALTER TABLE "customers" ADD COLUMN "phone_verified_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email")
  WHERE "email" IS NOT NULL AND "deleted_at" IS NULL;
