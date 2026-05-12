import { Injectable } from '@nestjs/common'

import { Command } from '@app/common'
import {
	NotificationStateMachine,
	RecordAttemptInput,
	SendVerdict
} from '../state-machine/notification.state-machine'

// Thin use-case wrapper over the state machine's transactional verdict. The
// command is the boundary the consumer talks to; the state machine owns the
// transitions and history-append.
@Injectable()
export class RecordSendAttemptCommand implements Command<RecordAttemptInput, SendVerdict> {
	constructor(private readonly stateMachine: NotificationStateMachine) {}

	execute(input: RecordAttemptInput): Promise<SendVerdict> {
		return this.stateMachine.recordAttempt(input)
	}
}
