import { Injectable } from '@nestjs/common'
import { HealthCheckResult, HealthCheckService } from '@nestjs/terminus'

@Injectable()
export class HealthService {
	constructor(private readonly health: HealthCheckService) {}

	check(): Promise<HealthCheckResult> {
		// Phase 1: empty checks. Phase 2 adds Prisma + RMQ pings.
		return this.health.check([])
	}
}
