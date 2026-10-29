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
  Matches,
  ArrayMaxSize,
  MaxLength,
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

  /** معرّفات ملفات المرفقات (من POST /files/contract) — تحل محل الحالية */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true, message: 'ملف مرفق غير صالح' })
  attachmentFileIds?: string[];
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
  // طول رقم الهوية يختلف من دولة لأخرى (السعودية 10، مصر 14…)
  @Matches(/^[0-9]{6,20}$/, {
    message: 'رقم الهوية يجب أن يتكون من 6 إلى 20 رقماً',
  })
  nationalId?: string;

  /** معرّف ملف صورة الهوية (من POST /files/employee)؛ null لإزالتها */
  @IsOptional()
  @IsUUID('4', { message: 'ملف الهوية غير صالح' })
  nationalIdCardFileId?: string | null;

  @IsString()
  @IsOptional()
  // دولي E.164 (+9665XXXXXXXX) أو محلي بالأرقام فقط: الطول يختلف من دولة لأخرى
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'رقم الهاتف غير صالح' })
  phone?: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  /** الفرع الذي يعمل فيه الموظف — يُترك فارغاً للفرع الرئيسي */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  // ✅ department أصبح departmentId
  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsUUID()
  @IsOptional()
  shiftId?: string;

  /**
   * رقم الموظف على جهاز البصمة إن اختلف عن كوده (موظف مسجّل على الجهاز من
   * قبل). فارغ/null = الجهاز يعرفه بكوده.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsString()
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'رقم البصمة حروف وأرقام فقط' })
  attendancePin?: string | null;

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
