ALTER TABLE "units" ADD COLUMN "hold_minutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "check_in_opens_minutes" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "units" ADD CONSTRAINT "units_hold_minutes_check" CHECK ("hold_minutes" BETWEEN 1 AND 30);

ALTER TABLE "units" ADD CONSTRAINT "units_check_in_opens_minutes_check" CHECK ("check_in_opens_minutes" BETWEEN 0 AND 240);
