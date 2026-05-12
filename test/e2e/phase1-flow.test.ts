import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { PrismaClient as NotifierPrisma } from '../../apps/notifier/prisma/generated'
import { PrismaClient as UsersPrisma } from '../../apps/users/prisma/generated'

const RUN = process.env.RUN_E2E_TESTS === '1'

const USERS_DB_URL = process.env.TEST_USERS_DB_URL ?? 'postgresql://app:pwd@localhost:5432/users'
const NOTIFICATIONS_DB_URL =
	process.env.TEST_NOTIFICATIONS_DB_URL ?? 'postgresql://app:pwd@localhost:5432/notifications'
const USERS_BASE_URL = process.env.TEST_USERS_BASE_URL ?? 'http://localhost:3000'

// Generous to absorb users-outbox cron (5s) + scheduled_for delay (10s) +
// notifier cron (5s) + send roundtrip. ~25s under perfect conditions.
const FLOW_TIMEOUT_MS = 45_000
const POLL_INTERVAL_MS = 500

const describeE2e = RUN ? describe : describe.skip

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// oxlint-disable-next-line no-await-in-loop -- polling is fundamentally
// sequential; each iteration depends on the previous having completed.
const pollUntil = async <T>(
	fn: () => Promise<T | null>,
	timeoutMs: number,
	label: string
): Promise<T> => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		// eslint-disable-next-line no-await-in-loop
		const value = await fn()
		if (value !== null) return value
		// eslint-disable-next-line no-await-in-loop
		await sleep(POLL_INTERVAL_MS)
	}
	throw new Error(`timed out waiting for: ${label}`)
}

describeE2e('Phase 1 e2e — POST /users → SENT notification', () => {
	const users = new UsersPrisma({ datasourceUrl: USERS_DB_URL })
	const notifier = new NotifierPrisma({ datasourceUrl: NOTIFICATIONS_DB_URL })

	beforeAll(async () => {
		// Hard reset between e2e runs — keep the local stack reusable.
		await notifier.$executeRawUnsafe(
			`TRUNCATE TABLE notification_history, notifications RESTART IDENTITY CASCADE`
		)
		await users.$executeRawUnsafe(`TRUNCATE TABLE users_outbox, users RESTART IDENTITY CASCADE`)
	})

	afterAll(async () => {
		await users.$disconnect()
		await notifier.$disconnect()
	})

	it(
		'POST /users → users row + outbox row + ingest + notification → SENT',
		async () => {
			const name = `e2e-${Date.now()}`

			// 1) POST /users
			const response = await fetch(`${USERS_BASE_URL}/users`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			})
			expect(response.status).toBe(201)
			const created = (await response.json()) as { id: string; name: string; createdAt: string }
			expect(created.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
			expect(created.name).toBe(name)

			// 2) users row landed
			const userRow = await users.user.findUnique({ where: { id: created.id } })
			expect(userRow).not.toBeNull()
			expect(userRow?.name).toBe(name)

			// 3) outbox row exists in same tx with sourceEventId
			const outboxBefore = await users.usersOutbox.findMany({
				where: { aggregateId: created.id }
			})
			expect(outboxBefore).toHaveLength(1)
			const [outboxRow] = outboxBefore
			expect(outboxRow.sourceEventId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
			expect(outboxRow.eventType).toBe('user.created')

			// 4) outbox is eventually marked published (users-outbox cron drives this).
			const publishedRow = await pollUntil(
				async () => {
					const row = await users.usersOutbox.findUnique({ where: { id: outboxRow.id } })
					return row?.publishedAt ? row : null
				},
				FLOW_TIMEOUT_MS,
				`users_outbox(${outboxRow.id}).published_at`
			)
			expect(publishedRow.publishedAt).toBeInstanceOf(Date)
			expect(publishedRow.publishingStartedAt).toBeNull()

			// 5) notification row created by IngestConsumer, dedup-keyed on (type, sourceEventId).
			const notification = await pollUntil(
				async () =>
					notifier.notification.findUnique({
						where: {
							type_sourceEventId: {
								type: 'USER_WELCOME',
								sourceEventId: outboxRow.sourceEventId
							}
						}
					}),
				FLOW_TIMEOUT_MS,
				`notification with sourceEventId=${outboxRow.sourceEventId}`
			)
			expect(notification.type).toBe('USER_WELCOME')
			expect(notification.channel).toBe('webhook')
			const recipient = notification.recipient as { userId?: string }
			expect(recipient.userId).toBe(created.id)
			const params = notification.params as { userId: string; name: string }
			expect(params).toEqual({ userId: created.id, name })

			// 6) notification reaches SENT
			const sent = await pollUntil(
				async () => {
					const row = await notifier.notification.findUnique({
						where: { id: notification.id }
					})
					return row?.status === 'SENT' ? row : null
				},
				FLOW_TIMEOUT_MS,
				`notification(${notification.id}).status=SENT`
			)
			expect(sent.attempts).toBeGreaterThanOrEqual(0)
			expect(sent.sentAt).toBeInstanceOf(Date)
			expect(sent.lastError).toBeNull()

			// 7) notification_history records the full timeline.
			const history = await notifier.notificationHistory.findMany({
				where: { notificationId: notification.id },
				orderBy: { at: 'asc' }
			})
			const events = history.map((h) => h.eventType)
			expect(events).toContain('CREATED')
			expect(events).toContain('CLAIMED_BY_TICK')
			expect(events).toContain('PUSH_SENT')
		},
		FLOW_TIMEOUT_MS + 5_000
	)

	it('re-POST with the same name creates a second, independent notification', async () => {
		const name = `e2e-second-${Date.now()}`

		const a = await fetch(`${USERS_BASE_URL}/users`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		})
		const b = await fetch(`${USERS_BASE_URL}/users`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name })
		})
		expect(a.status).toBe(201)
		expect(b.status).toBe(201)

		const userA = (await a.json()) as { id: string }
		const userB = (await b.json()) as { id: string }
		expect(userA.id).not.toBe(userB.id)

		// Eventually two distinct notifications exist (one per user). UNIQUE is on
		// (type, source_event_id), and source_event_id is per outbox row — so the
		// second user produces a second notification, not a dedup hit.
		const both = await pollUntil(
			async () => {
				const rows = await notifier.notification.findMany({
					where: {
						type: 'USER_WELCOME',
						OR: [
							{ recipient: { path: ['userId'], equals: userA.id } },
							{ recipient: { path: ['userId'], equals: userB.id } }
						]
					}
				})
				return rows.length === 2 ? rows : null
			},
			FLOW_TIMEOUT_MS,
			'two notifications for the two users'
		)
		expect(both).toHaveLength(2)
	})
})
