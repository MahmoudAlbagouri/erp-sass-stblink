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
import { ShiftsModule } from '../shifts/shifts.module'; // ✅ تم الاستيراد هنا

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BiometricDevice,
      AttendanceLog,
      DeviceCommand,
      Employee,
    ]),
    ShiftsModule, // ✅ استيراد موديول الورديات لحل مشكلة UnknownDependenciesException
  ],
  controllers: [AdmsController, AttendanceController],
  providers: [AdmsService, AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
