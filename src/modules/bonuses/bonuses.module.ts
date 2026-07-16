import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bonus } from './entities/bonus.entity';
import { Employee } from '../employees/entities/employee.entity';
import { BonusesService } from './bonuses.service';
import { BonusesController } from './bonuses.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Bonus, Employee])],
  controllers: [BonusesController],
  providers: [BonusesService],
  exports: [BonusesService], // ✅ مهم لاستخدامه داخل PayrollModule
})
export class BonusesModule {}
