import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResignationRequest } from './entities/resignation.entity';
import { Employee } from '../employees/entities/employee.entity';
import { ResignationsService } from './resignations.service';
import { ResignationsController } from './resignations.controller';
import { EOSModule } from '../eos/eos.module'; // ✅ استيراد موديول نهاية الخدمة

@Module({
  imports: [
    TypeOrmModule.forFeature([ResignationRequest, Employee]),
    EOSModule, // ✅ للوصول إلى EOSService لإنشاء سجل النهاية عند الموافقة
  ],
  controllers: [ResignationsController],
  providers: [ResignationsService],
  exports: [ResignationsService],
})
export class ResignationsModule {}
