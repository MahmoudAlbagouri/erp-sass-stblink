import { PartialType } from '@nestjs/swagger';
import { CreateEOSDto } from './create-eos.dto';

export class UpdateEOSDto extends PartialType(CreateEOSDto) {}
