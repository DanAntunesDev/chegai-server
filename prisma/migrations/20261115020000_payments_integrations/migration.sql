CREATE TYPE "BookingPaymentKind" AS ENUM ('DEPOSIT', 'FULL', 'REMAINDER');
CREATE TYPE "BookingPaymentStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED');

ALTER TABLE "tenants" ADD COLUMN "deposit_percent" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "tenants" ADD COLUMN "payment_api_key" TEXT;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_deposit_percent_check" CHECK ("deposit_percent" BETWEEN 0 AND 100);

CREATE TABLE "booking_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" "BookingPaymentKind" NOT NULL,
    "status" "BookingPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount_cents" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_link_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "payment_url" TEXT NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booking_payments_amount_check" CHECK ("amount_cents" > 0)
);

CREATE UNIQUE INDEX "booking_payments_provider_link_id_key" ON "booking_payments"("provider_link_id");
CREATE UNIQUE INDEX "booking_payments_provider_payment_id_key" ON "booking_payments"("provider_payment_id");
CREATE INDEX "booking_payments_tenant_id_booking_id_idx" ON "booking_payments"("tenant_id", "booking_id");

ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_payments" ADD CONSTRAINT "booking_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "booking_payments"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "platform_settings"
  USING (app_rls_bypassed())
  WITH CHECK (app_rls_bypassed());

CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_endpoints_tenant_id_idx" ON "webhook_endpoints"("tenant_id");
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "webhook_endpoints"
  USING (app_rls_bypassed())
  WITH CHECK (app_rls_bypassed());

CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status_code" INTEGER,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at" DESC);
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "webhook_deliveries"
  USING (app_rls_bypassed())
  WITH CHECK (app_rls_bypassed());
