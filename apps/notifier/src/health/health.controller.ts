import { Controller, Get } from '@nestjs/common'
import { HealthCheck, HealthCheckResult } from '@nestjs/terminus'

import { HealthService } from './health.service'

@Controller()
export class HealthController {
	constructor(private readonly healthService: HealthService) {}

	@Get('lhealth')
	lhealth(): { status: 'ok' } {
		return { status: 'ok' }
	}

	@Get('rhealth')
	@HealthCheck()
	rhealth(): Promise<HealthCheckResult> {
		return this.healthService.check()
	}
}
