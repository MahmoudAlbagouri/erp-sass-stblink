// src/modules/attendance/dto/link-pin.dto.ts
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** ربط رقم على جهاز البصمة بموظف (ومعه كل ما وصل بهذا الرقم من قبل) */
export class LinkPinDto {
  /** الرقم كما يظهر على الجهاز */
  @IsString()
  @IsNotEmpty({ message: 'رقم البصمة مطلوب' })
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'رقم البصمة حروف وأرقام فقط' })
  pin!: string;

  @IsUUID()
  employeeId!: string;
}
