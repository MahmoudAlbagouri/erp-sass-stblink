// src/modules/profile/profile.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { User } from '../users/entities/user.entity';
import { Employee } from '../employees/entities/employee.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { Salary } from '../salaries/entities/salary.entity';
import { LeaveBalance } from '../leaves/entities/leave-balance.entity';
import { LeaveRequest } from '../leaves/entities/leave-request.entity'; // ✅ تم الاستيراد
import { Advance } from '../advances/entities/advance.entity';
import { Loan } from '../loans/entities/loan.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Employee,
      Contract,
      Salary,
      LeaveBalance,
      LeaveRequest, // ✅ تمت الإضافة هنا لحل الخطأ
      Advance,
      Loan,
    ]),
  ],
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
