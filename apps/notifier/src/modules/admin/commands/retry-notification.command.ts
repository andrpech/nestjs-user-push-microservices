import { Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import { Notification } from '../../../../prisma/generated'
import { NotificationStateMachine } from '../../notifier/state-machine/notification.state-machine'

export type RetryOutcome =
	| { kind: 'retried'; row: Notification }
	| { kind: 'wrong_status'; currentStatus: string }
	| { kind: 'not_found' }

@Injectable()
export class RetryNotificationCommand implements Command<string, RetryOutcome> {
	constructor(private readonly stateMachine: NotificationStateMachine) {}

	execute(notificationId: string): Promise<RetryOutcome> {
		return this.stateMachine.manualRetry(notificationId)
	}
}
