import { PartialType } from '@nestjs/mapped-types';
import { CreateResignationDto } from './create-resignation.dto';

export class UpdateResignationDto extends PartialType(CreateResignationDto) {}
