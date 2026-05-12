import { Inject, Injectable } from '@nestjs/common'

import { Command, ulid } from '@app/common'
import { Prisma } from '../../../../prisma/generated'
import { UsersWritePrismaClient } from '../../../database/users.clients'
import type { IngestEvent } from '../dto/ingest.event'
import { UsersOutboxRepository } from '../repositories/users-outbox.repository'

export interface CreateUserInput {
	name: string
}

export interface CreateUserOutput {
	id: string
	name: string
	createdAt: Date
}

const USER_WELCOME_TYPE = 'USER_WELCOME'

@Injectable()
export class CreateUserCommand implements Command<CreateUserInput, CreateUserOutput> {
	constructor(
		@Inject(UsersWritePrismaClient)
		private readonly write: UsersWritePrismaClient,
		private readonly outbox: UsersOutboxRepository
	) {}

	async execute({ name }: CreateUserInput): Promise<CreateUserOutput> {
		const userId = ulid()
		const outboxId = ulid()
		const sourceEventId = ulid()

		const ingestPayload: IngestEvent = {
			type: USER_WELCOME_TYPE,
			sourceEventId,
			recipient: { userId },
			params: { userId, name }
		}

		const user = await this.write.$transaction(async (tx) => {
			const created = await tx.user.create({ data: { id: userId, name } })
			await this.outbox.enqueue(tx, {
				id: outboxId,
				aggregateId: created.id,
				eventType: 'user.created',
				sourceEventId,
				payload: ingestPayload as unknown as Prisma.InputJsonValue
			})
			return created
		})

		return { id: user.id, name: user.name, createdAt: user.createdAt }
	}
}
