// src/modules/attendance/attendance.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BiometricDevice } from './entities/biometric-device.entity';
import { AttendanceLog } from './entities/attendance-log.entity';
import { Employee } from '../employees/entities/employee.entity';
import { AdmsController } from './adms.controller';
import { AdmsService } from './adms.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { DeviceCommand } from './entities/device-command.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BiometricDevice,
      AttendanceLog,
      DeviceCommand,
      Employee,
    ]),
  ],
  controllers: [
    AdmsController, // ✅ بروتوكول ZKTeco (public - بدون JWT)
    AttendanceController, // ✅ إدارة الأجهزة والسجلات (protected)
  ],
  providers: [AdmsService, AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
