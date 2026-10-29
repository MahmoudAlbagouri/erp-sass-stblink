// src/modules/attendance/dto/push-punches.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PunchType, VerifyMode } from '../entities/attendance-log.entity';

const DEVICE_PUNCH_TYPES = Object.values(PunchType).filter(
  (type) => type !== PunchType.LEAVE,
);

export class PushedPunchDto {
  /** رقم الموظف على الجهاز */
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'رقم البصمة حروف وأرقام فقط' })
  pin!: string;

  /**
   * وقت البصمة ISO 8601: بمنطقته (2026-01-12T08:00:00+03:00) أو بلا منطقة
   * فيُقرأ بتوقيت الجهاز
   */
  @IsISO8601()
  time!: string;

  /** النوع إن عرفه الجهاز؛ غيابه لا يضر — اليوم يُقاس بأول بصمة وآخرها */
  @IsOptional()
  @IsIn(DEVICE_PUNCH_TYPES)
  type?: PunchType;

  @IsOptional()
  @IsIn(Object.values(VerifyMode))
  verifyMode?: VerifyMode;

  /** معرّف البصمة عند المرسل: إعادة إرسالها لا تكرّرها (افتراضياً الرقم + الوقت) */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;
}

export class PushPunchesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => PushedPunchDto)
  punches!: PushedPunchDto[];
}
