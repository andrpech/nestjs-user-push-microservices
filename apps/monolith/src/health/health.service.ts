import { Inject, Injectable } from '@nestjs/common'
import { HealthCheckResult, HealthCheckService, HealthIndicatorResult } from '@nestjs/terminus'

import { UsersReadPrismaClient, UsersWritePrismaClient } from '../database/users.clients'

@Injectable()
export class HealthService {
	constructor(
		private readonly health: HealthCheckService,
		@Inject(UsersReadPrismaClient)
		private readonly usersRead: UsersReadPrismaClient,
		@Inject(UsersWritePrismaClient)
		private readonly usersWrite: UsersWritePrismaClient
	) {}

	private async pingDb(
		name: string,
		client: UsersReadPrismaClient | UsersWritePrismaClient
	): Promise<HealthIndicatorResult> {
		await client.$queryRawUnsafe('SELECT 1')
		return { [name]: { status: 'up' } }
	}

	check(): Promise<HealthCheckResult> {
		return this.health.check([
			() => this.pingDb('users-read-db', this.usersRead),
			() => this.pingDb('users-write-db', this.usersWrite)
		])
	}
}
