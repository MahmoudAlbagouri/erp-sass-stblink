// src/modules/branches/branches.module.ts
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchScopeInterceptor } from './branch-scope.interceptor';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { Branch } from './entities/branch.entity';

/**
 * الفروع: الكيان نفسه وإدارته، ونطاق الفروع الذي يقيّد كل طلب بفروع صاحبه.
 *
 * باقي الموديولات لا تستورد هذا الموديول: تقرأ النطاق من branch-scope وتحصل
 * على الفرع الرئيسي من branches.util (دوال لا خدمات).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Branch])],
  controllers: [BranchesController],
  providers: [
    BranchesService,
    { provide: APP_INTERCEPTOR, useClass: BranchScopeInterceptor },
  ],
  exports: [BranchesService],
})
export class BranchesModule {}
