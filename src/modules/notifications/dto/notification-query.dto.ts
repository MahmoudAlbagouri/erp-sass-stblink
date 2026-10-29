// src/modules/notifications/dto/notification-query.dto.ts
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { NOTIFICATION_GROUPS, NOTIFICATION_TYPES } from '../notification-types';

const GROUP_KEYS = Object.keys(NOTIFICATION_GROUPS);
const TYPE_KEYS = Object.keys(NOTIFICATION_TYPES);

/** "true" / "false" في رابط الطلب ← boolean */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

export class InboxQueryDto extends PaginationQueryDto {
  /** true: غير المقروءة فقط */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unread?: boolean;

  /** مجموعة الأنواع (requests، hr، inventory...) */
  @IsOptional()
  @IsIn(GROUP_KEYS)
  group?: string;

  /** نوع بعينه (leave_request، iqama_expiry...) */
  @IsOptional()
  @IsIn(TYPE_KEYS)
  type?: string;
}

export class MarkReadDto {
  /** معرّفات الإشعارات */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class ReadAllDto {
  /** تعليم مجموعة واحدة فقط (فارغ = الكل) */
  @IsOptional()
  @IsIn(GROUP_KEYS)
  group?: string;
}

export class AdminNotificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(GROUP_KEYS)
  group?: string;

  @IsOptional()
  @IsIn(TYPE_KEYS)
  type?: string;

  /** بحث في العنوان والنص واسم المستلم */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UpdatePreferencesDto {
  /** الأنواع المكتومة (ما لا يُكتم يُرفض) */
  @IsArray()
  @ArrayMaxSize(TYPE_KEYS.length)
  @IsIn(TYPE_KEYS, { each: true })
  mutedTypes!: string[];
}
