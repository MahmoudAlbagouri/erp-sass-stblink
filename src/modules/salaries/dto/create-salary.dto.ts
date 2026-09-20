// src/modules/salaries/dto/create-salary.dto.ts
import {
  IsNotEmpty,
  IsNumber,
  IsUUID,
  IsOptional,
  Min,
  IsEnum,
  IsString,
  IsIBAN,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaymentMethodEnum } from '../../../common/enums/salary.enums';

export class CreateSalaryDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId!: string;

  @IsNumber() @Min(0) @IsNotEmpty() basicSalary!: number;
  @IsNumber() @Min(0) @IsOptional() housingAllowance: number = 0;
  @IsNumber() @Min(0) @IsOptional() transportAllowance: number = 0;
  @IsNumber() @Min(0) @IsOptional() otherAllowances: number = 0;

  @IsEnum(PaymentMethodEnum, { message: 'طريقة الدفع غير صالحة' })
  @IsNotEmpty({ message: 'طريقة الدفع مطلوبة' })
  paymentMethod!: PaymentMethodEnum;

  // ✅ إجباري فقط عند الدفع البنكي (ValidateIf يتجاهل كل الفحوص إذا لم يكن BANK)
  @ValidateIf(
    (o: CreateSalaryDto) => o.paymentMethod === PaymentMethodEnum.BANK,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value,
  )
  @IsString({ message: 'رقم الآيبان غير صالح' })
  @IsNotEmpty({ message: 'رقم الآيبان مطلوب عند الدفع البنكي' })
  @IsIBAN({ message: 'رقم الآيبان غير صالح' })
  iban?: string;
}
