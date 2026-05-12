import { Inject, Injectable } from '@nestjs/common'

import { ulid } from '@app/common'
import { MetricsService } from '@app/metrics'
import { Notification, Prisma } from '../../../../prisma/generated'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'
import {
	ClaimedNotification,
	NotificationsRepository
} from '../repositories/notifications.repository'

export type IngestInput = {
	type: string
	sourceEventId: string
	channel: string
	recipient: Prisma.InputJsonValue
	params: Prisma.InputJsonValue
	scheduledFor: Date
}

export type IngestResult = {
	notificationId: string
	deduped: boolean
}

export type SendOutcome = { ok: true } | { ok: false; error: string }

export type SendVerdict =
	| { kind: 'sent' }
	| { kind: 'terminal-failed' }
	| { kind: 'retry'; attempts: number }

export type RecordAttemptInput = {
	notificationId: string
	outcome: SendOutcome
	maxAttempts: number
}

export type RecoverStuckInput = {
	thresholdMs: number
	maxRedrives: number
}

export type ManualRetryOutcome =
	| { kind: 'retried'; row: Notification }
	| { kind: 'wrong_status'; currentStatus: string }
	| { kind: 'not_found' }

// Owns every PENDING → PROCESSING → SENT/FAILED transition. Every transition
// inserts a notification_history row in the same DB transaction so audit and
// state never disagree.
@Injectable()
export class NotificationStateMachine {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient,
		private readonly repo: NotificationsRepository,
		private readonly metrics: MetricsService
	) {}

	async ingest(input: IngestInput): Promise<IngestResult> {
		const id = ulid()
		try {
			await this.write.$transaction(async (tx) => {
				await this.repo.insert(tx, {
					id,
					type: input.type,
					sourceEventId: input.sourceEventId,
					recipient: input.recipient,
					params: input.params,
					channel: input.channel,
					scheduledFor: input.scheduledFor
				})
				await this.repo.appendHistory(tx, {
					notificationId: id,
					eventType: 'CREATED'
				})
			})
			this.metrics.notificationsCreatedTotal.inc()
			return { notificationId: id, deduped: false }
		} catch (error) {
			if (this.isUniqueViolation(error)) {
				const existing = await this.repo.findByIdempotencyKey(input.type, input.sourceEventId)
				if (existing) return { notificationId: existing.id, deduped: true }
			}
			throw error
		}
	}

	async claim(batchSize: number): Promise<ClaimedNotification[]> {
		const claimed = await this.repo.claimDue(batchSize)
		if (claimed.length === 0) return claimed
		await this.repo.appendHistoryBatch(
			claimed.map((row) => ({ notificationId: row.id, eventType: 'CLAIMED_BY_TICK' }))
		)
		return claimed
	}

	async recordAttempt(input: RecordAttemptInput): Promise<SendVerdict> {
		return this.write.$transaction(async (tx) => {
			if (input.outcome.ok) {
				await this.repo.markSent(tx, input.notificationId)
				await this.repo.appendHistory(tx, {
					notificationId: input.notificationId,
					eventType: 'PUSH_SENT'
				})
				this.metrics.notificationsSentTotal.inc()
				return { kind: 'sent' }
			}

			const errorMsg = input.outcome.error
			const { attempts } = await this.repo.incrementAttempt(tx, input.notificationId, errorMsg)
			await this.repo.appendHistory(tx, {
				notificationId: input.notificationId,
				eventType: 'PUSH_ATTEMPT',
				payload: { error: errorMsg }
			})

			if (attempts >= input.maxAttempts) {
				const { redriveCount } = await this.repo.markFailed(tx, input.notificationId, errorMsg)
				this.metrics.notificationsFailedTotal.labels({ reason: 'webhook_failure' }).inc()
				this.metrics.notificationRedriveCount.observe(redriveCount)
				return { kind: 'terminal-failed' }
			}

			return { kind: 'retry', attempts }
		})
	}

	async recoverStuck(input: RecoverStuckInput): Promise<{ recovered: number; failed: number }> {
		const { recovered, failed } = await this.repo.recoverStuck(input.thresholdMs, input.maxRedrives)

		const historyEntries = [
			...failed.map((row) => ({
				notificationId: row.id,
				eventType: 'REDRIVEN_FROM_STUCK',
				payload: {
					error: 'exceeded redrive limit',
					redriveCount: row.redriveCount
				} as Prisma.InputJsonValue
			})),
			...recovered.map((row) => ({
				notificationId: row.id,
				eventType: 'REDRIVEN_FROM_STUCK',
				payload: { redriveCount: row.redriveCount } as Prisma.InputJsonValue
			}))
		]
		await this.repo.appendHistoryBatch(historyEntries)

		for (const row of failed) {
			this.metrics.notificationsFailedTotal.labels({ reason: 'exceeded_redrive_limit' }).inc()
			this.metrics.notificationRedriveCount.observe(row.redriveCount)
		}
		for (const row of recovered) {
			this.metrics.notificationRedriveCount.observe(row.redriveCount)
		}

		return { recovered: recovered.length, failed: failed.length }
	}

	async manualRetry(notificationId: string): Promise<ManualRetryOutcome> {
		const updated = await this.repo.applyManualRetry(notificationId)
		if (updated) {
			await this.repo.appendHistory(this.write, {
				notificationId,
				eventType: 'MANUAL_RETRY'
			})
			return { kind: 'retried', row: updated }
		}

		const existing = await this.repo.findById(notificationId)
		if (!existing) return { kind: 'not_found' }
		return { kind: 'wrong_status', currentStatus: existing.status }
	}

	private isUniqueViolation(error: unknown): boolean {
		return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
	}
}
