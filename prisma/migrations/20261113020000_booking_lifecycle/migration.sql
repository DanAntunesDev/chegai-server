ALTER TABLE "units" ADD COLUMN "no_show_after_minutes" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "bookings" ADD COLUMN "checked_in_at" TIMESTAMPTZ(6),
ADD COLUMN "completed_at" TIMESTAMPTZ(6);

CREATE TABLE "booking_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "from_status" "BookingStatus",
    "to_status" "BookingStatus" NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "booking_events_booking_id_created_at_idx" ON "booking_events"("booking_id", "created_at");

CREATE INDEX "booking_events_tenant_id_idx" ON "booking_events"("tenant_id");

CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys"("created_at");

CREATE UNIQUE INDEX "idempotency_keys_tenant_id_key_key" ON "idempotency_keys"("tenant_id", "key");

ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "units" ADD CONSTRAINT "units_no_show_after_minutes_check" CHECK ("no_show_after_minutes" BETWEEN 0 AND 1440);

ALTER TABLE "booking_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "booking_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "booking_events"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "idempotency_keys"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());
