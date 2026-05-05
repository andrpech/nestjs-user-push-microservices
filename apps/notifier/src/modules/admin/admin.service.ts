import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { Notification, NotificationStatus } from '../../../prisma/generated'
import { NotificationsReadPrismaClient } from '../../database/notifications.clients'

export interface ListResult {
	items: Notification[]
	nextCursor: string | null
}

@Injectable()
export class AdminService {
	constructor(
		@Inject(NotificationsReadPrismaClient)
		private readonly read: NotificationsReadPrismaClient
	) {}

	async getById(id: string): Promise<Notification> {
		const row = await this.read.notification.findUnique({ where: { id } })
		if (!row) throw new NotFoundException(`notification ${id} not found`)
		return row
	}

	// ULID is sortable by id, so cursor-based pagination is "id < lastSeen ORDER BY id DESC".
	// We over-fetch by one to know if a next page exists without a separate count query.
	async list(opts: {
		status?: NotificationStatus
		limit: number
		cursor?: string
	}): Promise<ListResult> {
		const rows = await this.read.notification.findMany({
			where: {
				...(opts.status ? { status: opts.status } : {}),
				...(opts.cursor ? { id: { lt: opts.cursor } } : {})
			},
			orderBy: { id: 'desc' },
			take: opts.limit + 1
		})

		const hasMore = rows.length > opts.limit
		const items = hasMore ? rows.slice(0, opts.limit) : rows
		const nextCursor = hasMore ? items[items.length - 1].id : null
		return { items, nextCursor }
	}
}
