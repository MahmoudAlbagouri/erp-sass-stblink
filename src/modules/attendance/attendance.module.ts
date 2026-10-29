import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BiometricDevice } from './entities/biometric-device.entity';
import { AttendanceLog } from './entities/attendance-log.entity';
import { Employee } from '../employees/entities/employee.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { AttendanceSettings } from './entities/attendance-settings.entity';
import { PublicHoliday } from './entities/public-holiday.entity';
import { BiometricTemplate } from './entities/biometric-template.entity';
import { AdmsController } from './adms.controller';
import { AdmsService } from './adms.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceSettingsController } from './attendance-settings.controller';
import { AttendanceSettingsService } from './attendance-settings.service';
import { AttendanceImportService } from './attendance-import.service';
import { BiometricSyncService } from './biometric-sync.service';
import { DevicePushController } from './device-push.controller';
import { DevicePushService } from './device-push.service';
import { PunchIngestService } from './punch-ingest.service';
import { ShiftsModule } from '../shifts/shifts.module';
import { BiometricDevicesQuotaResolver } from './biometric-devices-quota.resolver';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ReportService } from '../../common/reports/report.service'; // ✅ لتصدير سجلات الحضور PDF/Excel

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BiometricDevice,
      AttendanceLog,
      DeviceCommand,
      Employee,
      AttendanceSettings,
      PublicHoliday,
      BiometricTemplate,
    ]),
    ShiftsModule, // ✅ استيراد موديول الورديات لحل مشكلة UnknownDependenciesException
    SubscriptionsModule, // ✅ استيراد موديول الاشتراكات
  ],
  controllers: [
    AdmsController,
    DevicePushController,
    AttendanceController,
    AttendanceSettingsController,
  ],
  providers: [
    AdmsService,
    AttendanceService,
    AttendanceSettingsService,
    AttendanceImportService,
    BiometricSyncService,
    DevicePushService,
    PunchIngestService,
    BiometricDevicesQuotaResolver,
    ReportService, // ✅ جديد
  ],
  exports: [AttendanceService, AttendanceSettingsService],
})
export class AttendanceModule {}
