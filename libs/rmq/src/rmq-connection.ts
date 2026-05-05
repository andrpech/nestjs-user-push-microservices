import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { AmqpConnectionManager, ChannelWrapper, connect } from 'amqp-connection-manager'

@Injectable()
export class RmqConnection implements OnModuleDestroy {
	private readonly logger = new Logger(RmqConnection.name)
	private connection: AmqpConnectionManager | undefined

	connect(url: string): AmqpConnectionManager {
		if (this.connection) return this.connection

		this.connection = connect([url])
		this.connection.on('connect', () => this.logger.log('AMQP connected'))
		this.connection.on('disconnect', ({ err }) =>
			this.logger.warn(`AMQP disconnected: ${err?.message ?? 'unknown'}`)
		)

		return this.connection
	}

	get manager(): AmqpConnectionManager {
		if (!this.connection) {
			throw new Error('RmqConnection.connect() has not been called')
		}

		return this.connection
	}

	createChannel(): ChannelWrapper {
		return this.manager.createChannel({ json: false })
	}

	createConfirmChannel(): ChannelWrapper {
		return this.manager.createChannel({ json: false, confirm: true })
	}

	isConnected(): boolean {
		return this.connection?.isConnected() ?? false
	}

	async onModuleDestroy(): Promise<void> {
		if (this.connection) {
			await this.connection.close()
		}
	}
}
