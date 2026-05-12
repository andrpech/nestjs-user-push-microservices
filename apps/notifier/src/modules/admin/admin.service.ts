import { Injectable, NotFoundException } from '@nestjs/common'

import { Notification, NotificationStatus } from '../../../prisma/generated'
import { NotificationsRepository } from '../notifier/repositories/notifications.repository'

export interface ListResult {
	items: Notification[]
	nextCursor: string | null
}

@Injectable()
export class AdminService {
	constructor(private readonly repo: NotificationsRepository) {}

	async getById(id: string): Promise<Notification> {
		const row = await this.repo.findById(id)
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
		const rows = await this.repo.list({
			status: opts.status,
			limit: opts.limit + 1,
			cursor: opts.cursor
		})

		const hasMore = rows.length > opts.limit
		const items = hasMore ? rows.slice(0, opts.limit) : rows
		const nextCursor = hasMore ? items[items.length - 1].id : null
		return { items, nextCursor }
	}
}
