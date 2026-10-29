// src/modules/notifications/dto/send-message.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export const MESSAGE_AUDIENCE_KINDS = [
  'all',
  'employees',
  'branches',
  'departments',
] as const;
export type MessageAudienceKind = (typeof MESSAGE_AUDIENCE_KINDS)[number];

export const MESSAGE_SEVERITIES = ['info', 'warning', 'danger'] as const;

export class MessageAudienceDto {
  /** all: الجميع · employees: موظفون بعينهم · branches / departments: موظفو فروع أو أقسام */
  @IsIn(MESSAGE_AUDIENCE_KINDS)
  kind!: MessageAudienceKind;

  /** معرّفات الموظفين / الفروع / الأقسام (لغير all) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  ids?: string[];
}

export class PreviewMessageDto {
  @ValidateNested()
  @Type(() => MessageAudienceDto)
  audience!: MessageAudienceDto;
}

export class SendMessageDto extends PreviewMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;

  /** info عادية · warning مهمة · danger عاجلة */
  @IsOptional()
  @IsIn(MESSAGE_SEVERITIES)
  severity?: (typeof MESSAGE_SEVERITIES)[number];

  /** يطلب من كل مستلم تأكيد «تم الاطلاع» */
  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;
}

export class SentMessagesQueryDto extends PaginationQueryDto {}
