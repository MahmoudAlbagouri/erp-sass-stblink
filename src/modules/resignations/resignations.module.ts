import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResignationRequest } from './entities/resignation.entity';
import { Employee } from '../employees/entities/employee.entity';
import { ResignationsService } from './resignations.service';
import { ResignationsController } from './resignations.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResignationRequest, Employee]),
    SubscriptionsModule,
  ],
  controllers: [ResignationsController],
  providers: [ResignationsService],
  exports: [ResignationsService],
})
export class ResignationsModule {}
