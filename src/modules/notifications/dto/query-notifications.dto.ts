import { IsOptional, IsEnum, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationCategory } from '../entities/notification.entity';

export class FindNotificationsDto {
  @IsOptional()
  @IsString()
  isRead?: string;

  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;
}

export class FindAllForAdminDto {
  @IsOptional()
  @IsString()
  isRead?: string;

  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;
}
