import { PartialType } from '@nestjs/swagger';
import { CreateBonusDto } from './create-bonus.dto';

export class UpdateBonusDto extends PartialType(CreateBonusDto) {}
