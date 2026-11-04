CREATE TYPE "BookingStatus" AS ENUM ('HOLD', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELED', 'NO_SHOW');

CREATE TYPE "BookingSource" AS ENUM ('PANEL', 'PUBLIC', 'WHATSAPP');

CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "BookingStatus" NOT NULL DEFAULT 'HOLD',
    "source" "BookingSource" NOT NULL DEFAULT 'PANEL',
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "blocked_until" TIMESTAMPTZ(6) NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(6),
    "total_price_cents" INTEGER NOT NULL,
    "notes" TEXT,
    "canceled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bookings_tenant_id_starts_at_idx" ON "bookings"("tenant_id", "starts_at");

CREATE INDEX "bookings_staff_id_starts_at_idx" ON "bookings"("staff_id", "starts_at");

CREATE INDEX "bookings_customer_id_idx" ON "bookings"("customer_id");

CREATE INDEX "booking_items_booking_id_idx" ON "booking_items"("booking_id");

CREATE INDEX "booking_items_tenant_id_idx" ON "booking_items"("tenant_id");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_range_check" CHECK ("starts_at" < "ends_at" AND "ends_at" <= "blocked_until");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
  "staff_id" WITH =,
  tstzrange("starts_at", "blocked_until", '[)') WITH &&
) WHERE ("status" IN ('HOLD', 'CONFIRMED', 'CHECKED_IN'));

ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bookings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "bookings"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "booking_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "booking_items"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());
