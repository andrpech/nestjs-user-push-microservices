import { Injectable } from '@nestjs/common'
import { HealthCheckResult, HealthCheckService } from '@nestjs/terminus'

import { RmqHealthIndicator } from '@app/rmq'

@Injectable()
export class HealthService {
	constructor(
		private readonly health: HealthCheckService,
		private readonly rmq: RmqHealthIndicator
	) {}

	check(): Promise<HealthCheckResult> {
		return this.health.check([() => this.rmq.check('rabbitmq')])
	}
}
