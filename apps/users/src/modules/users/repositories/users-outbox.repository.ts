import { Inject, Injectable } from '@nestjs/common'

import { Prisma } from '../../../../prisma/generated'
import { UsersWritePrismaClient } from '../../../database/users.clients'

// Subset of the Prisma client surface that an inline transaction can call. We
// type explicitly so callers don't have to import Prisma's internal namespace.
type TxClient = Pick<UsersWritePrismaClient, 'usersOutbox'>

export type ClaimedOutboxRow = {
	id: string
	aggregateId: string
	eventType: string
	payload: Prisma.JsonValue
	sourceEventId: string
}

@Injectable()
export class UsersOutboxRepository {
	constructor(
		@Inject(UsersWritePrismaClient)
		private readonly write: UsersWritePrismaClient
	) {}

	async enqueue(
		tx: TxClient,
		args: {
			id: string
			aggregateId: string
			eventType: string
			sourceEventId: string
			payload: Prisma.InputJsonValue
		}
	): Promise<void> {
		await tx.usersOutbox.create({
			data: {
				id: args.id,
				aggregateId: args.aggregateId,
				eventType: args.eventType,
				sourceEventId: args.sourceEventId,
				payload: args.payload
			}
		})
	}

	async sweepStuck(thresholdMs: number): Promise<number> {
		const result = await this.write.$executeRawUnsafe<number>(
			`UPDATE users_outbox
			 SET publishing_started_at = NULL
			 WHERE published_at IS NULL
			   AND publishing_started_at IS NOT NULL
			   AND publishing_started_at < NOW() - ($1::int * INTERVAL '1 millisecond')`,
			thresholdMs
		)
		return Number(result)
	}

	claimBatch(batchSize: number): Promise<ClaimedOutboxRow[]> {
		return this.write.$queryRawUnsafe<ClaimedOutboxRow[]>(
			`WITH eligible AS (
				SELECT id FROM users_outbox
				WHERE published_at IS NULL AND publishing_started_at IS NULL
				ORDER BY created_at ASC
				LIMIT $1
				FOR UPDATE SKIP LOCKED
			)
			UPDATE users_outbox
			SET publishing_started_at = NOW()
			WHERE id IN (SELECT id FROM eligible)
			RETURNING id,
			          aggregate_id AS "aggregateId",
			          event_type AS "eventType",
			          payload,
			          source_event_id AS "sourceEventId"`,
			batchSize
		)
	}

	async markPublished(id: string): Promise<void> {
		await this.write.$executeRawUnsafe(
			`UPDATE users_outbox
			 SET published_at = NOW(), publishing_started_at = NULL
			 WHERE id = $1`,
			id
		)
	}

	async releaseClaim(id: string): Promise<void> {
		await this.write.$executeRawUnsafe(
			`UPDATE users_outbox
			 SET publishing_started_at = NULL
			 WHERE id = $1 AND published_at IS NULL`,
			id
		)
	}
}
