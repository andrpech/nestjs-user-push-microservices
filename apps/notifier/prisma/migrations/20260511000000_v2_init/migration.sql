-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "recipient" JSONB NOT NULL,
    "params" JSONB NOT NULL,
    "channel" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processing_started_at" TIMESTAMP(3),
    "redrive_count" INTEGER NOT NULL DEFAULT 0,
    "last_redriven_at" TIMESTAMP(3),
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_history" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,

    CONSTRAINT "notification_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (UNIQUE on (type, source_event_id) — multi-type idempotency key)
CREATE UNIQUE INDEX "notifications_type_source_event_id_key" ON "notifications"("type", "source_event_id");

-- CreateIndex (claim hot path: PENDING + scheduled_for due — partial)
CREATE INDEX "notifications_pending_scheduled_idx" ON "notifications"("scheduled_for")
    WHERE "status" = 'PENDING';

-- CreateIndex (stuck-recovery hot path: PROCESSING with stale processing_started_at — partial)
CREATE INDEX "notifications_processing_started_idx" ON "notifications"("processing_started_at")
    WHERE "status" = 'PROCESSING';

-- CreateIndex (history timeline lookup)
CREATE INDEX "notification_history_notification_id_at_idx" ON "notification_history"("notification_id", "at");

-- AddForeignKey
ALTER TABLE "notification_history" ADD CONSTRAINT "notification_history_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
