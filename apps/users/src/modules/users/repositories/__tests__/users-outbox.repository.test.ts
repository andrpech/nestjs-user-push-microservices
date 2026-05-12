import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { ulid } from '@app/common'
import { Prisma, PrismaClient } from '../../../../../prisma/generated'
import { UsersWritePrismaClient } from '../../../../database/users.clients'
import { UsersOutboxRepository } from '../users-outbox.repository'

const RUN = process.env.RUN_DB_TESTS === '1'
const TEST_URL = process.env.TEST_USERS_DB_URL ?? 'postgresql://app:pwd@localhost:5432/users'

const describeDb = RUN ? describe : describe.skip

describeDb('UsersOutboxRepository (real Postgres)', () => {
	const prisma = new PrismaClient({
		datasourceUrl: TEST_URL
	}) as unknown as UsersWritePrismaClient
	const repo = new UsersOutboxRepository(prisma)

	const truncate = async (): Promise<void> => {
		await prisma.$executeRawUnsafe(`TRUNCATE TABLE users_outbox, users RESTART IDENTITY CASCADE`)
	}

	const seedUser = async (id = ulid(), name = 'Andrii'): Promise<string> => {
		await prisma.user.create({ data: { id, name } })
		return id
	}

	beforeEach(async () => {
		await truncate()
	})

	afterAll(async () => {
		await prisma.$disconnect()
	})

	describe('enqueue', () => {
		it('inserts a row visible after the transaction commits', async () => {
			const userId = await seedUser()
			const outboxId = ulid()
			const sourceEventId = ulid()

			await prisma.$transaction(async (tx) => {
				await repo.enqueue(tx, {
					id: outboxId,
					aggregateId: userId,
					eventType: 'user.created',
					sourceEventId,
					payload: { hello: 'world' } as Prisma.InputJsonValue
				})
			})

			const row = await prisma.usersOutbox.findUnique({ where: { id: outboxId } })
			expect(row?.aggregateId).toBe(userId)
			expect(row?.sourceEventId).toBe(sourceEventId)
			expect(row?.publishedAt).toBeNull()
			expect(row?.publishingStartedAt).toBeNull()
		})
	})

	describe('claimBatch', () => {
		it('claims pending rows and marks publishing_started_at', async () => {
			const userId = await seedUser()
			const id1 = ulid()
			const id2 = ulid()
			await prisma.$transaction(async (tx) => {
				await repo.enqueue(tx, {
					id: id1,
					aggregateId: userId,
					eventType: 'user.created',
					sourceEventId: ulid(),
					payload: {} as Prisma.InputJsonValue
				})
				await repo.enqueue(tx, {
					id: id2,
					aggregateId: userId,
					eventType: 'user.created',
					sourceEventId: ulid(),
					payload: {} as Prisma.InputJsonValue
				})
			})

			const claimed = await repo.claimBatch(10)
			expect(claimed.map((r) => r.id).toSorted()).toEqual([id1, id2].toSorted())

			const rows = await Promise.all(
				claimed.map((c) => prisma.usersOutbox.findUnique({ where: { id: c.id } }))
			)
			for (const row of rows) {
				expect(row?.publishingStartedAt).not.toBeNull()
				expect(row?.publishedAt).toBeNull()
			}
		})

		it('does not return already-claimed rows', async () => {
			const userId = await seedUser()
			const id1 = ulid()
			await prisma.$transaction(async (tx) => {
				await repo.enqueue(tx, {
					id: id1,
					aggregateId: userId,
					eventType: 'user.created',
					sourceEventId: ulid(),
					payload: {} as Prisma.InputJsonValue
				})
			})

			const first = await repo.claimBatch(10)
			const second = await repo.claimBatch(10)
			expect(first).toHaveLength(1)
			expect(second).toHaveLength(0)
		})

		it('does not return rows already marked published', async () => {
			const userId = await seedUser()
			const id1 = ulid()
			await prisma.$transaction(async (tx) => {
				await repo.enqueue(tx, {
					id: id1,
					aggregateId: userId,
					eventType: 'user.created',
					sourceEventId: ulid(),
					payload: {} as Prisma.InputJsonValue
				})
			})
			const claimed = await repo.claimBatch(10)
			await repo.markPublished(claimed[0].id)

			const next = await repo.claimBatch(10)
			expect(next).toHaveLength(0)
		})
	})

	describe('markPublished', () => {
		it('is idempotent', async () => {
			const userId = await seedUser()
			const id1 = ulid()
			await prisma.$transaction(async (tx) => {
				await repo.enqueue(tx, {
					id: id1,
					aggregateId: userId,
					eventType: 'user.created',
					sourceEventId: ulid(),
					payload: {} as Prisma.InputJsonValue
				})
			})
			await repo.claimBatch(10)
			await repo.markPublished(id1)
			await repo.markPublished(id1)
			const row = await prisma.usersOutbox.findUnique({ where: { id: id1 } })
			expect(row?.publishedAt).not.toBeNull()
		})
	})

	describe('sweepStuck', () => {
		it('only resets rows whose publishing_started_at is past the threshold', async () => {
			const userId = await seedUser()
			const fresh = ulid()
			const stale = ulid()
			await prisma.$transaction(async (tx) => {
				await repo.enqueue(tx, {
					id: fresh,
					aggregateId: userId,
					eventType: 'user.created',
					sourceEventId: ulid(),
					payload: {} as Prisma.InputJsonValue
				})
				await repo.enqueue(tx, {
					id: stale,
					aggregateId: userId,
					eventType: 'user.created',
					sourceEventId: ulid(),
					payload: {} as Prisma.InputJsonValue
				})
			})
			await repo.claimBatch(10)
			await prisma.$executeRawUnsafe(
				`UPDATE users_outbox SET publishing_started_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
				stale
			)

			const swept = await repo.sweepStuck(60_000)
			expect(swept).toBe(1)

			const freshRow = await prisma.usersOutbox.findUnique({ where: { id: fresh } })
			const staleRow = await prisma.usersOutbox.findUnique({ where: { id: stale } })
			expect(freshRow?.publishingStartedAt).not.toBeNull()
			expect(staleRow?.publishingStartedAt).toBeNull()
		})
	})
})
