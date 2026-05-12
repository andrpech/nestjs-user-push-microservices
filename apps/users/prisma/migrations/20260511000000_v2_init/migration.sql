-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users_outbox" (
    "id" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "publishing_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_outbox_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "users_outbox" ADD CONSTRAINT "users_outbox_aggregate_id_fkey" FOREIGN KEY ("aggregate_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex (claim hot path; partial index, Prisma schema cannot express WHERE)
CREATE INDEX "users_outbox_claim_idx" ON "users_outbox" ("created_at")
    WHERE "published_at" IS NULL AND "publishing_started_at" IS NULL;
