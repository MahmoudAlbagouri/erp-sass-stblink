import { Module } from '@nestjs/common';
import { AdvancesService } from './advances.service';
import { AdvancesController } from './advances.controller';
import { Advance } from './entities/advance.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Advance])],
  controllers: [AdvancesController],
  providers: [AdvancesService],
  exports: [AdvancesService], // مهم لتستخدمه في الـ AttendanceService لاحقاً
})
export class AdvancesModule {}
