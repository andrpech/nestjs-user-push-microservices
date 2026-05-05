import { DynamicModule, Module } from '@nestjs/common'

import { RmqConnection } from './rmq-connection'
import { RmqHealthIndicator } from './rmq-health.indicator'

export type RmqModuleOptions = {
	url: () => string
}

@Module({
	providers: [RmqConnection, RmqHealthIndicator],
	exports: [RmqConnection, RmqHealthIndicator]
})
export class RmqModule {
	static forRoot(options: RmqModuleOptions): DynamicModule {
		return {
			module: RmqModule,
			global: true,
			providers: [
				{
					provide: RmqConnection,
					useFactory: (): RmqConnection => {
						const conn = new RmqConnection()
						conn.connect(options.url())
						return conn
					}
				},
				RmqHealthIndicator
			],
			exports: [RmqConnection, RmqHealthIndicator]
		}
	}
}
