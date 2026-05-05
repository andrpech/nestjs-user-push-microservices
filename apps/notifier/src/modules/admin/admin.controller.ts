import {
	Body,
	ConflictException,
	Controller,
	Get,
	HttpCode,
	NotFoundException,
	Param,
	Post,
	Query
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { ZodSchema } from '@app/zod-validation'
import { Notification } from '../../../prisma/generated'
import { AdminService } from './admin.service'
import { RepublishInboxDlqCommand, RepublishResult } from './commands/republish-inbox-dlq.command'
import { RetryNotificationCommand } from './commands/retry-notification.command'
import {
	GetNotificationParam,
	GetNotificationParamSchema,
	ListNotificationsQuery,
	ListNotificationsQuerySchema,
	RepublishInboxDlqBody,
	RepublishInboxDlqBodySchema
} from './dto/get-notification.dto'

@Controller('admin')
export class AdminController {
	constructor(
		private readonly admin: AdminService,
		private readonly retryCmd: RetryNotificationCommand,
		private readonly republishCmd: RepublishInboxDlqCommand,
		private readonly logger: PinoLogger
	) {}

	@Get('notifications')
	@ZodSchema(ListNotificationsQuerySchema)
	async list(
		@Query() query: ListNotificationsQuery
	): Promise<{ items: Notification[]; nextCursor: string | null }> {
		this.logger.assign({ adminQuery: query })
		return this.admin.list(query)
	}

	@Get('notifications/:id')
	@ZodSchema(GetNotificationParamSchema)
	async getById(@Param() params: GetNotificationParam): Promise<Notification> {
		this.logger.assign({ notificationId: params.id })
		return this.admin.getById(params.id)
	}

	@Post('notifications/:id/retry')
	@HttpCode(200)
	@ZodSchema(GetNotificationParamSchema)
	async retry(@Param() params: GetNotificationParam): Promise<Notification> {
		this.logger.assign({ notificationId: params.id })
		const outcome = await this.retryCmd.execute(params.id)
		if (outcome.kind === 'not_found') {
			throw new NotFoundException(`notification ${params.id} not found`)
		}
		if (outcome.kind === 'wrong_status') {
			throw new ConflictException(
				`notification ${params.id} is ${outcome.currentStatus}, can only retry FAILED`
			)
		}
		return outcome.row
	}

	@Post('dlq/inbox/republish')
	@HttpCode(200)
	@ZodSchema(RepublishInboxDlqBodySchema)
	async republishInboxDlq(@Body() body: RepublishInboxDlqBody): Promise<RepublishResult> {
		this.logger.assign({ adminBody: body })
		return this.republishCmd.execute(body)
	}
}
