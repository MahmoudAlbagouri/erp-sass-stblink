// src/modules/pos/dto/pos-screen.dto.ts
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, ValidateNested } from 'class-validator';
import {
  POS_TEMPLATE_KEYS,
  type PosTemplateKey,
} from '../../../common/constants/pos-features';

/** ما يُغيَّر من مميزات الشاشة (الغائب يبقى كما هو) */
export class PosFeaturesPatchDto {
  @IsOptional() @IsBoolean() customers?: boolean;
  @IsOptional() @IsBoolean() addCustomer?: boolean;
  @IsOptional() @IsBoolean() creditSales?: boolean;
  @IsOptional() @IsBoolean() lineDiscount?: boolean;
  @IsOptional() @IsBoolean() invoiceDiscount?: boolean;
  @IsOptional() @IsBoolean() priceChange?: boolean;
  @IsOptional() @IsBoolean() units?: boolean;
  @IsOptional() @IsBoolean() holdSales?: boolean;
  @IsOptional() @IsBoolean() cardPayments?: boolean;
  @IsOptional() @IsBoolean() quickPay?: boolean;
  @IsOptional() @IsBoolean() autoPrint?: boolean;
  @IsOptional() @IsBoolean() cashMoves?: boolean;
  @IsOptional() @IsBoolean() manualDrawer?: boolean;
  @IsOptional() @IsBoolean() returns?: boolean;
  @IsOptional() @IsBoolean() scaleBarcode?: boolean;
  @IsOptional() @IsBoolean() showStock?: boolean;
  @IsOptional() @IsBoolean() numpad?: boolean;
  @IsOptional() @IsBoolean() customerDisplay?: boolean;
  @IsOptional() @IsBoolean() delivery?: boolean;
  @IsOptional() @IsBoolean() tables?: boolean;
  @IsOptional() @IsBoolean() kitchen?: boolean;
}

export class UpdatePosScreenSettingsDto {
  /** تطبيق قالب جاهز (ثم `features` فوقه إن أُرسلت) */
  @IsOptional()
  @IsIn(POS_TEMPLATE_KEYS)
  template?: PosTemplateKey;

  @IsOptional()
  @ValidateNested()
  @Type(() => PosFeaturesPatchDto)
  features?: PosFeaturesPatchDto;
}
