import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  IsEmail,
  IsNumber,
  IsIBAN,
  Min,
  ValidateIf,
  ValidateNested,
  IsArray,
  Length,
  Matches,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { NationalityType } from '../entities/employee.entity';
import { ContractType } from '../../contracts/entities/contract.entity';
import {
  TicketType,
  ProbationPeriod,
  MedicalInsuranceType,
} from '../../contracts/entities/contract.entity';
import { PaymentMethodEnum } from '../../../common/enums/salary.enums';
import { EducationDto } from './education.dto';

export class OnboardUserDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب' })
  username!: string;

  @IsEmail({}, { message: 'بريد إلكتروني غير صالح' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  password!: string;

  @IsUUID()
  @IsOptional()
  roleId?: string;

  @IsString()
  @IsOptional()
  roleName?: string;

  @IsArray()
  @IsOptional()
  permissionIds?: string[];
}

export class OnboardContractDto {
  @IsEnum(ContractType)
  @IsNotEmpty()
  contractType!: ContractType;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsNumber()
  @IsOptional()
  annualLeaveDays?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  contractDurationMonths?: number;

  @IsEnum(TicketType)
  @IsOptional()
  ticketType?: TicketType;

  @IsEnum(ProbationPeriod)
  @IsOptional()
  probationPeriod?: ProbationPeriod;

  @IsEnum(MedicalInsuranceType)
  @IsOptional()
  medicalInsurance?: MedicalInsuranceType;

  @IsString()
  @IsOptional()
  nationality?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  attachmentPaths?: string[];
}

export class OnboardSalaryDto {
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  basicSalary!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  housingAllowance?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  transportAllowance?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  otherAllowances?: number;

  @IsEnum(PaymentMethodEnum, { message: 'طريقة الدفع غير صالحة' })
  @IsNotEmpty({ message: 'طريقة الدفع مطلوبة' })
  paymentMethod!: PaymentMethodEnum;

  // ✅ إجباري فقط عند الدفع البنكي
  @ValidateIf(
    (o: OnboardSalaryDto) => o.paymentMethod === PaymentMethodEnum.BANK,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value,
  )
  @IsString({ message: 'رقم الآيبان غير صالح' })
  @IsNotEmpty({ message: 'رقم الآيبان مطلوب عند الدفع البنكي' })
  @IsIBAN({ message: 'رقم الآيبان غير صالح' })
  iban?: string;
}

export class OnboardEmployeeDto {
  @IsString()
  @IsNotEmpty({ message: 'الاسم الكامل مطلوب' })
  fullName!: string;

  @IsEnum(NationalityType)
  @IsNotEmpty({ message: 'نوع الجنسية مطلوب' })
  nationalityType!: NationalityType;

  @ValidateNested({ each: true })
  @Type(() => EducationDto)
  @IsArray()
  @IsOptional()
  educations?: EducationDto[];

  @ValidateIf(
    (o: OnboardEmployeeDto) => o.nationalityType === NationalityType.NON_SAUDI,
  )
  @IsDateString({}, { message: 'تاريخ انتهاء الإقامة مطلوب لغير السعوديين' })
  iqamaExpiryDate?: string;

  @IsString()
  @IsOptional()
  @Length(10, 10, { message: 'رقم الهوية يجب أن يتكون من 10 أرقام' })
  @Matches(/^[0-9]{10}$/, { message: 'رقم الهوية يجب أن يحتوي على أرقام فقط' })
  nationalId?: string;

  @IsString()
  @IsOptional()
  nationalIdCardPath?: string;

  @IsString()
  @IsOptional()
  @Length(10, 10, { message: 'رقم الهاتف يجب أن يتكون من 10 أرقام' })
  @Matches(/^[0-9]{10}$/, { message: 'رقم الهاتف يجب أن يحتوي على أرقام فقط' })
  phone?: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  // ✅ department أصبح departmentId
  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsUUID()
  @IsOptional()
  shiftId?: string;

  @IsEnum(['active', 'inactive', 'terminated'])
  @IsOptional()
  status?: 'active' | 'inactive' | 'terminated';

  @ValidateNested()
  @Type(() => OnboardUserDto)
  @IsOptional()
  user?: OnboardUserDto;

  @ValidateNested()
  @Type(() => OnboardContractDto)
  @IsOptional()
  contract?: OnboardContractDto;

  @ValidateNested()
  @Type(() => OnboardSalaryDto)
  @IsOptional()
  salary?: OnboardSalaryDto;
}
