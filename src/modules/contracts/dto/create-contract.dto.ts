import {
  IsNotEmpty,
  IsString,
  IsDateString,
  IsOptional,
  IsNumber,
  IsUUID,
  IsEnum,
  IsArray,
  Min,
} from 'class-validator';
import {
  ContractType,
  TicketType,
  ProbationPeriod,
  MedicalInsuranceType, // ✅ استيراد النوع الجديد
} from '../entities/contract.entity';

export class CreateContractDto {
  @IsUUID()
  @IsNotEmpty()
  employeeId!: string;

  @IsEnum(ContractType)
  @IsNotEmpty()
  contractType!: ContractType;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsNumber()
  @IsNotEmpty()
  annualLeaveDays!: number;

  // ✅ تغيير المدة إلى شهور ليتوافق مع منطق الحساب الجديد
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

  // ✅ إضافة الحقول الجديدة للـ DTO
  @IsEnum(MedicalInsuranceType)
  @IsOptional()
  medicalInsurance?: MedicalInsuranceType;

  @IsString()
  @IsOptional()
  nationality?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  attachmentPaths?: string[];
}
