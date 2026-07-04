// src/modules/settlements/dto/confirm-settlement.dto.ts
import {
  IsUUID,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export enum SettlementType {
  FULL = 'FULL',
  PARTIAL = 'PARTIAL',
}

/**
 * ✅ ملاحظة تصميم مهمة: لا يحتوي هذا الـ DTO على unusedLeaveDays/dailyRate/
 * totalAmount كمدخلات من العميل كما كان سابقاً. هذه القيم تُحسب الآن دائماً
 * من طرف الخادم (بناءً على الرصيد الفعلي والراتب المسجّل)، لمنع أي تلاعب
 * من الواجهة الأمامية بقيمة التسوية المالية.
 */
export class ConfirmSettlementDto {
  @IsUUID('4', { message: 'معرّف الموظف غير صالح' })
  employeeId!: string;

  @IsDateString({}, { message: 'تاريخ التسوية غير صالح' })
  settlementDate!: string;

  @IsEnum(SettlementType, {
    message: 'نوع التسوية يجب أن يكون FULL (كاملة) أو PARTIAL (جزئية)',
  })
  settlementType!: SettlementType;

  /** إلزامي فقط في حالة PARTIAL — عدد الأيام المطلوب صرفها نقدياً */
  @ValidateIf(
    (o: ConfirmSettlementDto) => o.settlementType === SettlementType.PARTIAL,
  )
  @IsInt({ message: 'عدد الأيام يجب أن يكون رقماً صحيحاً' })
  @IsPositive({ message: 'عدد الأيام يجب أن يكون أكبر من صفر' })
  daysToSettle?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'الملاحظات طويلة جداً (الحد الأقصى 1000 حرف)' })
  notes?: string;
}
