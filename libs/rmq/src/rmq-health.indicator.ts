import { Injectable } from '@nestjs/common'
import { HealthCheckError, HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus'

import { RmqConnection } from './rmq-connection'

@Injectable()
export class RmqHealthIndicator extends HealthIndicator {
	constructor(private readonly conn: RmqConnection) {
		super()
	}

	check(key: string): HealthIndicatorResult {
		const isConnected = this.conn.isConnected()
		const result = this.getStatus(key, isConnected, { connected: isConnected })

		if (!isConnected) {
			throw new HealthCheckError('RabbitMQ disconnected', result)
		}

		return result
	}
}
