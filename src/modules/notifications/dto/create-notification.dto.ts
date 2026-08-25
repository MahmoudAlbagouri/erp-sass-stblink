import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { NotificationCategory } from '../entities/notification.entity';

export class CreateNotificationDto {
  @IsString()
  @IsNotEmpty()
  recipientId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsEnum(NotificationCategory)
  category!: NotificationCategory;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  referenceType?: string;

  @IsOptional()
  @IsString()
  actionUrl?: string;
}
