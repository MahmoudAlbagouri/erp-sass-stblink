// src/modules/attendance/dto/update-attendance-log.dto.ts
import { IsDateString, IsOptional, IsString, IsEnum } from 'class-validator';
import { PunchType } from '../entities/attendance-log.entity';

export class UpdateAttendanceLogDto {
  @IsDateString()
  punchTime!: string;

  @IsOptional()
  @IsEnum(PunchType)
  punchType?: PunchType;

  // ✅ مطلوب فقط لو punchType = leave (يتحقق منها في الـ Service)
  @IsOptional()
  @IsString()
  leaveReason?: string;
}
