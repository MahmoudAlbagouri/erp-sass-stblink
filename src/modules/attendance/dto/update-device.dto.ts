// src/modules/attendance/dto/update-device.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateDeviceDto } from './create-device.dto';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { DeviceStatus } from '../entities/biometric-device.entity';

export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {
  @IsOptional()
  @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
