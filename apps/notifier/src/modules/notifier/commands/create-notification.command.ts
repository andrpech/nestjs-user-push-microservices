import { Inject, Injectable } from '@nestjs/common'

import { Command, ulid } from '@app/common'
import { Prisma } from '../../../../prisma/generated'
import { NotificationsWritePrismaClient } from '../../../database/notifications.clients'
import { historyEntry } from '../history'

export interface CreateNotificationInput {
	userId: string
	name: string
}

export interface CreateNotificationOutput {
	notificationId: string
	deduped: boolean
}

@Injectable()
export class CreateNotificationCommand implements Command<
	CreateNotificationInput,
	CreateNotificationOutput
> {
	constructor(
		@Inject(NotificationsWritePrismaClient)
		private readonly write: NotificationsWritePrismaClient
	) {}

	async execute({ userId, name }: CreateNotificationInput): Promise<CreateNotificationOutput> {
		try {
			const row = await this.write.notification.create({
				data: { id: ulid(), userId, name, history: [historyEntry('CREATED')] }
			})
			return { notificationId: row.id, deduped: false }
		} catch (error) {
			if (this.isUniqueViolation(error)) {
				const existing = await this.write.notification.findUnique({ where: { userId } })
				if (existing) {
					return { notificationId: existing.id, deduped: true }
				}
			}
			throw error
		}
	}

	private isUniqueViolation(error: unknown): boolean {
		return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
	}
}
