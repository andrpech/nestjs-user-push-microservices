import { Injectable } from '@nestjs/common'

import { Producer, RmqProducer } from '@app/rmq'
import type { CronTick } from '../dto/cron-tick.dto'

@Injectable()
@Producer({
	exchange: 'system.cron',
	routingKey: 'cron.notifier',
	exchangeType: 'topic'
})
export class NotifierCronProducer extends RmqProducer<CronTick> {}
