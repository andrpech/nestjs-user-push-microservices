import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { MetricsService } from '@app/metrics'
import { Prisma, PrismaClient } from '../../../../../prisma/generated'
import {
	NotificationsReadPrismaClient,
	NotificationsWritePrismaClient
} from '../../../../database/notifications.clients'
import { NotificationsRepository } from '../../repositories/notifications.repository'
import { NotificationStateMachine } from '../notification.state-machine'

const RUN = process.env.RUN_DB_TESTS === '1'
const TEST_URL =
	process.env.TEST_NOTIFICATIONS_DB_URL ?? 'postgresql://app:pwd@localhost:5432/notifications'

const describeDb = RUN ? describe : describe.skip

describeDb('NotificationStateMachine (real Postgres)', () => {
	const prisma = new PrismaClient({
		datasourceUrl: TEST_URL
	}) as unknown as NotificationsWritePrismaClient & NotificationsReadPrismaClient
	const repo = new NotificationsRepository(prisma, prisma)
	const metrics = new MetricsService()
	const sm = new NotificationStateMachine(prisma, repo, metrics)

	const truncate = async (): Promise<void> => {
		await prisma.$executeRawUnsafe(
			`TRUNCATE TABLE notification_history, notifications RESTART IDENTITY CASCADE`
		)
	}

	beforeEach(async () => {
		await truncate()
	})

	afterAll(async () => {
		await prisma.$disconnect()
	})

	const ingestArgs = (
		overrides: Partial<Parameters<typeof sm.ingest>[0]> = {}
	): Parameters<typeof sm.ingest>[0] => ({
		type: 'USER_WELCOME',
		sourceEventId: 'src-1',
		channel: 'webhook',
		recipient: { userId: 'u-1' } as unknown as Prisma.InputJsonValue,
		params: { userId: 'u-1', name: 'Andrii' } as unknown as Prisma.InputJsonValue,
		scheduledFor: new Date(Date.now() - 1_000),
		...overrides
	})

	describe('ingest', () => {
		it('creates a notification and a CREATED history entry', async () => {
			const result = await sm.ingest(ingestArgs())
			expect(result.deduped).toBe(false)

			const row = await prisma.notification.findUnique({ where: { id: result.notificationId } })
			expect(row?.status).toBe('PENDING')

			const history = await prisma.notificationHistory.findMany({
				where: { notificationId: result.notificationId }
			})
			expect(history.map((h) => h.eventType)).toEqual(['CREATED'])
		})

		it('dedupes on (type, sourceEventId)', async () => {
			const first = await sm.ingest(ingestArgs({ sourceEventId: 'src-dup' }))
			const second = await sm.ingest(ingestArgs({ sourceEventId: 'src-dup' }))
			expect(second.deduped).toBe(true)
			expect(second.notificationId).toBe(first.notificationId)

			const count = await prisma.notification.count({ where: { sourceEventId: 'src-dup' } })
			expect(count).toBe(1)
		})

		it('treats different sourceEventId as distinct events', async () => {
			await sm.ingest(ingestArgs({ sourceEventId: 'src-a' }))
			await sm.ingest(ingestArgs({ sourceEventId: 'src-b' }))
			const count = await prisma.notification.count({ where: { type: 'USER_WELCOME' } })
			expect(count).toBe(2)
		})
	})

	describe('claim', () => {
		it('transitions PENDING → PROCESSING and appends CLAIMED_BY_TICK', async () => {
			const { notificationId } = await sm.ingest(ingestArgs({ sourceEventId: 'src-claim' }))
			const claimed = await sm.claim(10)
			expect(claimed.map((c) => c.id)).toEqual([notificationId])

			const row = await prisma.notification.findUnique({ where: { id: notificationId } })
			expect(row?.status).toBe('PROCESSING')

			const history = await prisma.notificationHistory.findMany({
				where: { notificationId },
				orderBy: { at: 'asc' }
			})
			expect(history.map((h) => h.eventType)).toEqual(['CREATED', 'CLAIMED_BY_TICK'])
		})

		it('skips rows whose scheduled_for is still in the future', async () => {
			await sm.ingest(
				ingestArgs({
					sourceEventId: 'src-future',
					scheduledFor: new Date(Date.now() + 60_000)
				})
			)
			const claimed = await sm.claim(10)
			expect(claimed).toEqual([])
		})
	})

	describe('recordAttempt', () => {
		it('marks SENT on success and appends PUSH_SENT', async () => {
			const { notificationId } = await sm.ingest(ingestArgs({ sourceEventId: 'src-ok' }))
			await sm.claim(10)
			const verdict = await sm.recordAttempt({
				notificationId,
				outcome: { ok: true },
				maxAttempts: 5
			})
			expect(verdict.kind).toBe('sent')

			const row = await prisma.notification.findUnique({ where: { id: notificationId } })
			expect(row?.status).toBe('SENT')
			expect(row?.sentAt).not.toBeNull()
		})

		it('returns retry verdict when attempts below max', async () => {
			const { notificationId } = await sm.ingest(ingestArgs({ sourceEventId: 'src-retry' }))
			await sm.claim(10)
			const verdict = await sm.recordAttempt({
				notificationId,
				outcome: { ok: false, error: 'boom' },
				maxAttempts: 3
			})
			expect(verdict).toEqual({ kind: 'retry', attempts: 1 })

			const row = await prisma.notification.findUnique({ where: { id: notificationId } })
			expect(row?.status).toBe('PROCESSING')
			expect(row?.attempts).toBe(1)
			expect(row?.lastError).toBe('boom')
		})

		it('crosses to terminal-failed atomically on the attempt that hits max', async () => {
			const { notificationId } = await sm.ingest(ingestArgs({ sourceEventId: 'src-term' }))
			await sm.claim(10)
			await sm.recordAttempt({
				notificationId,
				outcome: { ok: false, error: 'boom-1' },
				maxAttempts: 2
			})
			const verdict = await sm.recordAttempt({
				notificationId,
				outcome: { ok: false, error: 'boom-2' },
				maxAttempts: 2
			})
			expect(verdict.kind).toBe('terminal-failed')

			const row = await prisma.notification.findUnique({ where: { id: notificationId } })
			expect(row?.status).toBe('FAILED')
			expect(row?.attempts).toBe(2)
		})
	})

	describe('recoverStuck', () => {
		it('resets stale PROCESSING rows under the redrive cap', async () => {
			const { notificationId } = await sm.ingest(ingestArgs({ sourceEventId: 'src-stuck' }))
			await sm.claim(10)
			await prisma.$executeRawUnsafe(
				`UPDATE notifications SET processing_started_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
				notificationId
			)

			const result = await sm.recoverStuck({ thresholdMs: 60_000, maxRedrives: 5 })
			expect(result).toEqual({ recovered: 1, failed: 0 })

			const row = await prisma.notification.findUnique({ where: { id: notificationId } })
			expect(row?.status).toBe('PENDING')
			expect(row?.redriveCount).toBe(1)
		})

		it('terminates rows past the redrive cap', async () => {
			const { notificationId } = await sm.ingest(ingestArgs({ sourceEventId: 'src-cap' }))
			await sm.claim(10)
			await prisma.$executeRawUnsafe(
				`UPDATE notifications
				 SET processing_started_at = NOW() - INTERVAL '10 minutes',
				     redrive_count = 5
				 WHERE id = $1`,
				notificationId
			)

			const result = await sm.recoverStuck({ thresholdMs: 60_000, maxRedrives: 5 })
			expect(result).toEqual({ recovered: 0, failed: 1 })

			const row = await prisma.notification.findUnique({ where: { id: notificationId } })
			expect(row?.status).toBe('FAILED')
			expect(row?.lastError).toBe('exceeded redrive limit')
		})
	})

	describe('manualRetry', () => {
		it('returns not_found for unknown id', async () => {
			const outcome = await sm.manualRetry('01HZZZZZZZZZZZZZZZZZZZZZZZ')
			expect(outcome).toEqual({ kind: 'not_found' })
		})

		it('returns wrong_status when not FAILED', async () => {
			const { notificationId } = await sm.ingest(ingestArgs({ sourceEventId: 'src-pending' }))
			const outcome = await sm.manualRetry(notificationId)
			expect(outcome.kind).toBe('wrong_status')
		})

		it('flips FAILED → PENDING and appends MANUAL_RETRY', async () => {
			const { notificationId } = await sm.ingest(ingestArgs({ sourceEventId: 'src-failed' }))
			await sm.claim(10)
			await sm.recordAttempt({
				notificationId,
				outcome: { ok: false, error: 'boom' },
				maxAttempts: 1
			})

			const outcome = await sm.manualRetry(notificationId)
			expect(outcome.kind).toBe('retried')

			const row = await prisma.notification.findUnique({ where: { id: notificationId } })
			expect(row?.status).toBe('PENDING')
			expect(row?.attempts).toBe(0)
			expect(row?.lastError).toBeNull()

			const lastHistory = await prisma.notificationHistory.findMany({
				where: { notificationId },
				orderBy: { at: 'desc' },
				take: 1
			})
			expect(lastHistory[0]?.eventType).toBe('MANUAL_RETRY')
		})
	})
})
