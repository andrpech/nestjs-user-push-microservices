import { Injectable } from '@nestjs/common'

import { Producer, RmqProducer } from '@app/rmq'
import type { CronTick } from '../dto/cron-tick.dto'

@Injectable()
@Producer({
	exchange: 'system.cron',
	routingKey: 'cron.notifier',
	exchangeType: 'topic',
	// Phase 13 — un-routable cron messages fall through to the catch-all queue.
	exchangeArgs: { 'alternate-exchange': 'unrouted.alt' }
})
export class NotifierCronProducer extends RmqProducer<CronTick> {}
