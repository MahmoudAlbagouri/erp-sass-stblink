// src/modules/attendance/dto/create-manual-attendance-log.dto.ts
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { PunchType, VerifyMode } from '../entities/attendance-log.entity';

export class CreateManualAttendanceLogDto {
  @IsUUID()
  employeeId!: string;

  @IsDateString()
  punchTime!: string;

  @IsEnum(PunchType)
  punchType!: PunchType;

  // ✅ إلزامي فقط عند اختيار "إجازة"
  @ValidateIf(
    (o: CreateManualAttendanceLogDto) => o.punchType === PunchType.LEAVE,
  )
  @IsString()
  @IsNotEmpty({ message: 'سبب الإجازة مطلوب' })
  leaveReason?: string;

  @IsOptional()
  @IsEnum(VerifyMode)
  verifyMode?: VerifyMode;
}
