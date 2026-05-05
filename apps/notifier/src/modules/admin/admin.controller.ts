import { Controller, Get, Param, Query } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { ZodSchema } from '@app/zod-validation'
import { Notification } from '../../../prisma/generated'
import { AdminService } from './admin.service'
import {
	GetNotificationParam,
	GetNotificationParamSchema,
	ListNotificationsQuery,
	ListNotificationsQuerySchema
} from './dto/get-notification.dto'

@Controller('admin/notifications')
export class AdminController {
	constructor(
		private readonly admin: AdminService,
		private readonly logger: PinoLogger
	) {}

	@Get()
	@ZodSchema(ListNotificationsQuerySchema)
	async list(
		@Query() query: ListNotificationsQuery
	): Promise<{ items: Notification[]; nextCursor: string | null }> {
		this.logger.assign({ adminQuery: query })
		return this.admin.list(query)
	}

	@Get(':id')
	@ZodSchema(GetNotificationParamSchema)
	async getById(@Param() params: GetNotificationParam): Promise<Notification> {
		this.logger.assign({ notificationId: params.id })
		return this.admin.getById(params.id)
	}
}
