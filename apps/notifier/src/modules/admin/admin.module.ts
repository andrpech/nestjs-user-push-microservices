import { Module } from '@nestjs/common'

import { NotificationsDatabaseModule } from '../../database/notifications.database.module'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
	imports: [NotificationsDatabaseModule],
	controllers: [AdminController],
	providers: [AdminService]
})
export class AdminModule {}
