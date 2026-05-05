import { Inject, Injectable } from '@nestjs/common'
import { HealthCheckResult, HealthCheckService, HealthIndicatorResult } from '@nestjs/terminus'

import { RmqHealthIndicator } from '@app/rmq'
import {
	NotificationsReadPrismaClient,
	NotificationsWritePrismaClient
} from '../database/notifications.clients'

type AnyPrismaClient = {
	$queryRawUnsafe: (sql: string) => Promise<unknown>
}

@Injectable()
export class HealthService {
	constructor(
		private readonly health: HealthCheckService,
		@Inject(NotificationsReadPrismaClient)
		private readonly notificationsRead: NotificationsReadPrismaClient,
		@Inject(NotificationsWritePrismaClient)
		private readonly notificationsWrite: NotificationsWritePrismaClient,
		private readonly rmq: RmqHealthIndicator
	) {}

	private async pingDb(name: string, client: AnyPrismaClient): Promise<HealthIndicatorResult> {
		await client.$queryRawUnsafe('SELECT 1')
		return { [name]: { status: 'up' } }
	}

	check(): Promise<HealthCheckResult> {
		return this.health.check([
			() => this.pingDb('notifications-read-db', this.notificationsRead),
			() => this.pingDb('notifications-write-db', this.notificationsWrite),
			() => this.rmq.check('rabbitmq')
		])
	}
}
