-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "publishing_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- Partial index for outbox claim hot path (Prisma doesn't support partial indexes in schema)
CREATE INDEX "users_outbox_claim_idx" ON "users" ("created_at")
    WHERE "published_at" IS NULL AND "publishing_started_at" IS NULL;
