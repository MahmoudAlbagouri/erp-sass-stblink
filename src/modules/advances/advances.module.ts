// src/modules/advances/advances.module.ts
import { Module } from '@nestjs/common';
import { AdvancesService } from './advances.service';
import { AdvancesController } from './advances.controller';
import { Advance } from './entities/advance.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalariesModule } from '../salaries/salaries.module'; // استيراد موديول الرواتب

@Module({
  imports: [
    TypeOrmModule.forFeature([Advance]),
    SalariesModule, // مهم للوصول لـ SalariesService
  ],
  controllers: [AdvancesController],
  providers: [AdvancesService],
  exports: [AdvancesService],
})
export class AdvancesModule {}
