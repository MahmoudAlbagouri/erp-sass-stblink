// src/modules/attendance/dto/create-device.dto.ts
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'الرقم التسلسلي للجهاز مطلوب' })
  serialNumber!: string; // SN مثل JHG3255001087

  @IsOptional()
  @IsString()
  alias?: string; // "بوابة المدخل الرئيسي"

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  model?: string; // MB10
}
