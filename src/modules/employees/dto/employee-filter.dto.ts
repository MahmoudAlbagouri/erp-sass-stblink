import {
  IsOptional,
  IsString,
  IsEnum,
  IsBooleanString,
  IsUUID,
} from 'class-validator';
import { NationalityType } from '../entities/employee.entity';

export class EmployeeFilterDto {
  @IsOptional()
  @IsEnum(['active', 'inactive', 'terminated'])
  status?: 'active' | 'inactive' | 'terminated';

  @IsOptional()
  @IsEnum(NationalityType)
  nationalityType?: NationalityType;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  shiftId?: string;

  @IsOptional()
  @IsBooleanString()
  hasUser?: string;

  @IsOptional()
  @IsBooleanString()
  hasContract?: string;

  @IsOptional()
  @IsBooleanString()
  iqamaExpiringSoon?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
