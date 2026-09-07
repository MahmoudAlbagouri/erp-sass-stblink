import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BiometricDevice } from './entities/biometric-device.entity';
import { AttendanceLog } from './entities/attendance-log.entity';
import { Employee } from '../employees/entities/employee.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { AdmsController } from './adms.controller';
import { AdmsService } from './adms.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { ShiftsModule } from '../shifts/shifts.module';
import { BiometricDevicesQuotaResolver } from './biometric-devices-quota.resolver';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module'; // ✅ لإرسال إشعارات التعديل/الإضافة
import { ReportService } from '../../common/reports/report.service'; // ✅ لتصدير سجلات الحضور PDF/Excel

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BiometricDevice,
      AttendanceLog,
      DeviceCommand,
      Employee,
    ]),
    ShiftsModule, // ✅ استيراد موديول الورديات لحل مشكلة UnknownDependenciesException
    SubscriptionsModule, // ✅ استيراد موديول الاشتراكات
    NotificationsModule, // ✅ جديد
  ],
  controllers: [AdmsController, AttendanceController],
  providers: [
    AdmsService,
    AttendanceService,
    BiometricDevicesQuotaResolver,
    ReportService, // ✅ جديد
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
