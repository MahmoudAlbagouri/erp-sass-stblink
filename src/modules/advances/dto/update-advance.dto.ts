import { PartialType } from '@nestjs/swagger';
import { CreateAdvanceDto } from './create-advance.dto';

export class UpdateAdvanceDto extends PartialType(CreateAdvanceDto) {}
