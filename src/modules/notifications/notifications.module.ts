// src/modules/notifications/notifications.module.ts
// الجدولة (ScheduleModule) والأحداث مسجّلة مرة واحدة في AppModule — تسجيلها
// هنا ثانيةً كان يشغّل كل مهمة دورية في النظام مرتين (أصل تكرار الإشعارات).
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationRecipient } from './entities/notification-recipient.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationAlertState } from './entities/notification-alert-state.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationMessagesController } from './notification-messages.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsAdminService } from './notifications-admin.service';
import { NotificationMessagesService } from './notification-messages.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationAudienceService } from './notification-audience.service';
import { NotificationLookupService } from './notification-lookup.service';
import { NotificationStreamService } from './notification-stream.service';
import { NotifierService } from './notifier.service';
import { HrRequestsListener } from './listeners/hr-requests.listener';
import { PayrollListener } from './listeners/payroll.listener';
import { EmployeesListener } from './listeners/employees.listener';
import { OperationsListener } from './listeners/operations.listener';
import { PlatformListener } from './listeners/platform.listener';
import { AttendanceDevicesListener } from './listeners/attendance-devices.listener';
import { AlertStatesService } from './scanners/alert-states.service';
import { HrExpiryScanner } from './scanners/hr-expiry.scanner';
import { SubscriptionExpiryScanner } from './scanners/subscription-expiry.scanner';
import { LowStockScanner } from './scanners/low-stock.scanner';
import { AttendanceDevicesScanner } from './scanners/attendance-devices.scanner';
import { AccountingErrorsScanner } from './scanners/accounting-errors.scanner';
import { InvoicesDueScanner } from './scanners/invoices-due.scanner';
import { NotificationsCleanupScanner } from './scanners/cleanup.scanner';
import { NotificationChecksService } from './scanners/notification-checks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Notification,
      NotificationRecipient,
      NotificationPreference,
      NotificationAlertState,
    ]),
  ],
  // الرسائل أولاً: مساراتها الثابتة قبل /notifications/:id
  controllers: [NotificationMessagesController, NotificationsController],
  providers: [
    // النواة
    NotifierService,
    NotificationAudienceService,
    NotificationLookupService,
    NotificationStreamService,
    // الصندوق، الإدارة، الرسائل، التفضيلات
    NotificationsService,
    NotificationsAdminService,
    NotificationMessagesService,
    NotificationPreferencesService,
    // المستمعات (أحداث الموديولات ← إشعارات)
    HrRequestsListener,
    PayrollListener,
    EmployeesListener,
    OperationsListener,
    PlatformListener,
    AttendanceDevicesListener,
    // الفحوص الدورية
    AlertStatesService,
    HrExpiryScanner,
    SubscriptionExpiryScanner,
    LowStockScanner,
    AttendanceDevicesScanner,
    AccountingErrorsScanner,
    InvoicesDueScanner,
    NotificationsCleanupScanner,
    NotificationChecksService,
  ],
  exports: [NotifierService],
})
export class NotificationsModule {}
