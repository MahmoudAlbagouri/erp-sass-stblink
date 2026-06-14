import { PartialType } from '@nestjs/mapped-types';
import { CreateAdvanceDto } from './create-advance.dto';

export class UpdateAdvanceDto extends PartialType(CreateAdvanceDto) {}
