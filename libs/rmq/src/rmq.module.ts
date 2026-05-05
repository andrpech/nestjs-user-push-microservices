import { Module } from '@nestjs/common'

import { RmqConnection } from './rmq-connection'
import { RmqHealthIndicator } from './rmq-health.indicator'

@Module({
	providers: [RmqConnection, RmqHealthIndicator],
	exports: [RmqConnection, RmqHealthIndicator]
})
export class RmqModule {}
