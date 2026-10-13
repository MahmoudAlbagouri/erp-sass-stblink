import { PartialType } from '@nestjs/swagger';
import { CreateResignationDto } from './create-resignation.dto';

export class UpdateResignationDto extends PartialType(CreateResignationDto) {}
