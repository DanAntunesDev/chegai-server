CREATE TYPE "TagScope" AS ENUM ('ALL', 'CUSTOMERS', 'STAFF');

CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "note" TEXT,
    "scope" "TagScope" NOT NULL DEFAULT 'ALL',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tags_color_check" CHECK ("color" ~ '^#[0-9a-fA-F]{6}$')
);

CREATE UNIQUE INDEX "tags_tenant_id_name_key" ON "tags"("tenant_id", "name");

ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "customer_tags" (
    "customer_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("customer_id","tag_id")
);

CREATE INDEX "customer_tags_tag_id_idx" ON "customer_tags"("tag_id");
CREATE INDEX "customer_tags_tenant_id_idx" ON "customer_tags"("tenant_id");

ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "staff_tags" (
    "staff_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,

    CONSTRAINT "staff_tags_pkey" PRIMARY KEY ("staff_id","tag_id")
);

CREATE INDEX "staff_tags_tag_id_idx" ON "staff_tags"("tag_id");
CREATE INDEX "staff_tags_tenant_id_idx" ON "staff_tags"("tenant_id");

ALTER TABLE "staff_tags" ADD CONSTRAINT "staff_tags_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_tags" ADD CONSTRAINT "staff_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "tags"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "customer_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "customer_tags"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

ALTER TABLE "staff_tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "staff_tags"
  USING (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id())
  WITH CHECK (app_rls_bypassed() OR "tenant_id" = app_current_tenant_id());

INSERT INTO "tags" ("id", "tenant_id", "name", "updated_at")
SELECT DISTINCT ON (c."tenant_id", lower(t.name)) gen_random_uuid(), c."tenant_id", t.name, CURRENT_TIMESTAMP
FROM "customers" c CROSS JOIN LATERAL unnest(c."tags") AS t(name)
WHERE c."deleted_at" IS NULL AND btrim(t.name) <> '';

INSERT INTO "customer_tags" ("customer_id", "tag_id", "tenant_id")
SELECT DISTINCT c."id", g."id", c."tenant_id"
FROM "customers" c
CROSS JOIN LATERAL unnest(c."tags") AS t(name)
JOIN "tags" g ON g."tenant_id" = c."tenant_id" AND g."name" = t.name::citext
WHERE c."deleted_at" IS NULL;

ALTER TABLE "customers" DROP COLUMN "tags";
