import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ResignationStatus } from '../entities/resignation.entity';

export class DecisionResignationDto {
  @IsEnum([ResignationStatus.APPROVED, ResignationStatus.REJECTED])
  newStatus!: ResignationStatus.APPROVED | ResignationStatus.REJECTED;

  @IsString()
  @IsOptional()
  managerNotes?: string;
}
