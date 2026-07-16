import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deduction } from './entities/deduction.entity';
import { Employee } from '../employees/entities/employee.entity';
import { DeductionsService } from './deduction.service';
import { DeductionsController } from './deduction.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Deduction, Employee])],
  controllers: [DeductionsController],
  providers: [DeductionsService],
  exports: [DeductionsService], // ✅ مهم لاستخدامه داخل PayrollModule
})
export class DeductionsModule {}
