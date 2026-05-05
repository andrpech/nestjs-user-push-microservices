import { Inject, Injectable } from '@nestjs/common'
import { HealthCheckResult, HealthCheckService, HealthIndicatorResult } from '@nestjs/terminus'

import { RmqHealthIndicator } from '@app/rmq'
import {
	NotificationsReadPrismaClient,
	NotificationsWritePrismaClient
} from '../database/notifications.clients'
import { UsersReadPrismaClient, UsersWritePrismaClient } from '../database/users.clients'

type AnyPrismaClient = {
	$queryRawUnsafe: (sql: string) => Promise<unknown>
}

@Injectable()
export class HealthService {
	constructor(
		private readonly health: HealthCheckService,
		@Inject(UsersReadPrismaClient)
		private readonly usersRead: UsersReadPrismaClient,
		@Inject(UsersWritePrismaClient)
		private readonly usersWrite: UsersWritePrismaClient,
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
			() => this.pingDb('users-read-db', this.usersRead),
			() => this.pingDb('users-write-db', this.usersWrite),
			() => this.pingDb('notifications-read-db', this.notificationsRead),
			() => this.pingDb('notifications-write-db', this.notificationsWrite),
			() => this.rmq.check('rabbitmq')
		])
	}
}
