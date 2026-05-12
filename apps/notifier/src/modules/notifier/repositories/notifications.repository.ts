import { Inject, Injectable } from '@nestjs/common'

import { ulid } from '@app/common'
import { Notification, Prisma } from '../../../../prisma/generated'
import {
	NotificationsReadPrismaClient,
	NotificationsWritePrismaClient
} from '../../../database/notifications.clients'

// The narrow Prisma surface a command running inside an interactive transaction
// can touch. Explicit so callers don't have to import Prisma's internal types.
type WriteClient = NotificationsWritePrismaClient
type WriteClientLike = Pick<WriteClient, 'notification' | 'notificationHistory'>

export type ClaimedNotification = {
	id: string
	type: string
	sourceEventId: string
	recipient: Prisma.JsonValue
	params: Prisma.JsonValue
	channel: string
}

export type InsertArgs = {
	id: string
	type: string
	sourceEventId: string
	recipient: Prisma.InputJsonValue
	params: Prisma.InputJsonValue
	channel: string
	scheduledFor: Date
}

export type HistoryEntryInput = {
	notificationId: string
	eventType: string
	payload?: Prisma.InputJsonValue
}

@Injectable()
export class NotificationsRepository {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: WriteClient,
		@Inject(NotificationsReadPrismaClient)
		private readonly read: NotificationsReadPrismaClient
	) {}

	// --- reads ---

	findById(id: string): Promise<Notification | null> {
		return this.read.notification.findUnique({ where: { id } })
	}

	findByIdempotencyKey(type: string, sourceEventId: string): Promise<Notification | null> {
		return this.write.notification.findUnique({
			where: { type_sourceEventId: { type, sourceEventId } }
		})
	}

	// --- writes ---

	async insert(client: WriteClientLike, args: InsertArgs): Promise<Notification> {
		return client.notification.create({ data: args })
	}

	async appendHistory(client: WriteClientLike, entry: HistoryEntryInput): Promise<void> {
		await client.notificationHistory.create({
			data: {
				id: ulid(),
				notificationId: entry.notificationId,
				eventType: entry.eventType,
				payload: entry.payload
			}
		})
	}

	// --- claim / state transitions (raw SQL because of FOR UPDATE SKIP LOCKED) ---

	claimDue(batchSize: number): Promise<ClaimedNotification[]> {
		return this.write.$queryRawUnsafe<ClaimedNotification[]>(
			`WITH due AS (
				SELECT id FROM notifications
				WHERE status = 'PENDING'
				  AND scheduled_for <= NOW()
				ORDER BY scheduled_for ASC
				LIMIT $1
				FOR UPDATE SKIP LOCKED
			)
			UPDATE notifications
			SET status = 'PROCESSING',
			    processing_started_at = NOW(),
			    updated_at = NOW()
			WHERE id IN (SELECT id FROM due)
			RETURNING id,
			          type,
			          source_event_id AS "sourceEventId",
			          recipient,
			          params,
			          channel`,
			batchSize
		)
	}

	async markSent(client: WriteClientLike, notificationId: string): Promise<void> {
		await client.notification.update({
			where: { id: notificationId },
			data: { status: 'SENT', sentAt: new Date() }
		})
	}

	async incrementAttempt(
		client: WriteClientLike,
		notificationId: string,
		errorMsg: string
	): Promise<{ attempts: number }> {
		const row = await client.notification.update({
			where: { id: notificationId },
			data: {
				attempts: { increment: 1 },
				lastError: errorMsg
			},
			select: { attempts: true }
		})
		return { attempts: row.attempts }
	}

	async markFailed(
		client: WriteClientLike,
		notificationId: string,
		errorMsg: string
	): Promise<{ redriveCount: number }> {
		const row = await client.notification.update({
			where: { id: notificationId },
			data: {
				status: 'FAILED',
				lastError: errorMsg,
				processingStartedAt: null
			},
			select: { redriveCount: true }
		})
		return { redriveCount: row.redriveCount }
	}

	async recoverStuck(
		thresholdMs: number,
		maxRedrives: number
	): Promise<{
		recovered: { id: string; redriveCount: number }[]
		failed: { id: string; redriveCount: number }[]
	}> {
		// Past the redrive cap → terminal FAILED.
		const failed = await this.write.$queryRawUnsafe<{ id: string; redriveCount: number }[]>(
			`UPDATE notifications
			 SET status = 'FAILED',
			     last_error = 'exceeded redrive limit',
			     processing_started_at = NULL,
			     updated_at = NOW()
			 WHERE status = 'PROCESSING'
			   AND processing_started_at < NOW() - ($1::int * INTERVAL '1 millisecond')
			   AND redrive_count >= $2
			 RETURNING id, redrive_count AS "redriveCount"`,
			thresholdMs,
			maxRedrives
		)

		// Eligible → reset to PENDING.
		const recovered = await this.write.$queryRawUnsafe<{ id: string; redriveCount: number }[]>(
			`UPDATE notifications
			 SET status = 'PENDING',
			     processing_started_at = NULL,
			     redrive_count = redrive_count + 1,
			     last_redriven_at = NOW(),
			     updated_at = NOW()
			 WHERE status = 'PROCESSING'
			   AND processing_started_at < NOW() - ($1::int * INTERVAL '1 millisecond')
			   AND redrive_count < $2
			 RETURNING id, redrive_count AS "redriveCount"`,
			thresholdMs,
			maxRedrives
		)

		return { recovered, failed }
	}

	async appendHistoryBatch(entries: HistoryEntryInput[]): Promise<void> {
		if (entries.length === 0) return
		await this.write.notificationHistory.createMany({
			data: entries.map((entry) => ({
				id: ulid(),
				notificationId: entry.notificationId,
				eventType: entry.eventType,
				payload: entry.payload
			}))
		})
	}

	async list(opts: {
		status?: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED'
		limit: number
		cursor?: string
	}): Promise<Notification[]> {
		return this.read.notification.findMany({
			where: {
				...(opts.status ? { status: opts.status } : {}),
				...(opts.cursor ? { id: { lt: opts.cursor } } : {})
			},
			orderBy: { id: 'desc' },
			take: opts.limit
		})
	}

	// FAILED → PENDING. Returns the new row, or null if status mismatch.
	async applyManualRetry(notificationId: string): Promise<Notification | null> {
		try {
			const row = await this.write.notification.update({
				where: { id: notificationId, status: 'FAILED' },
				data: {
					status: 'PENDING',
					attempts: 0,
					processingStartedAt: null,
					lastError: null
				}
			})
			return row
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
				return null
			}
			throw error
		}
	}
}
