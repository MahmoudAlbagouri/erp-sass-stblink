import { PartialType } from '@nestjs/mapped-types';
import { CreateEOSDto } from './create-eos.dto';

export class UpdateEOSDto extends PartialType(CreateEOSDto) {}
