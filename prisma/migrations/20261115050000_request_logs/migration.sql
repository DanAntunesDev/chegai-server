CREATE TABLE "request_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "user_id" UUID,
    "actor" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "route" TEXT,
    "query" JSONB,
    "payload" JSONB,
    "headers" JSONB,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "request_logs_created_at_idx" ON "request_logs"("created_at" DESC);
CREATE INDEX "request_logs_tenant_id_created_at_idx" ON "request_logs"("tenant_id", "created_at" DESC);
CREATE INDEX "request_logs_status_code_idx" ON "request_logs"("status_code");

ALTER TABLE "request_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "request_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "system_only" ON "request_logs"
  USING (app_rls_bypassed())
  WITH CHECK (app_rls_bypassed());

CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);
