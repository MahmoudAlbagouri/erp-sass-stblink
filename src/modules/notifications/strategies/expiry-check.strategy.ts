// src/modules/notifications/strategies/expiry-check.strategy.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract } from '../../contracts/entities/contract.entity';
import { NotificationsService } from '../notifications.service';
import {
  NotificationCategory,
  Notification,
} from '../entities/notification.entity';

@Injectable()
export class ExpiryCheckStrategy {
  private readonly logger = new Logger(ExpiryCheckStrategy.name);

  constructor(
    @InjectRepository(Contract)
    private contractRepo: Repository<Contract>,
    @InjectRepository(Notification)
    private notificationRepo: Repository<Notification>,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * دالة مساعدة لتوحيد صيغة التاريخ (منتصف اليوم) وتجنب مشاكل المقارنة الزمنية
   */
  private getStartOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * دالة مساعدة لتحويل أي قيمة تاريخية (String أو Date) إلى كائن Date صالح
   * ترجع null إذا كانت القيمة غير صالحة
   */
  private safeParseDate(value: any): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  /**
   * نقطة دخول يدوية للاختبار الفوري
   */
  async runManualCheck() {
    this.logger.log(
      '[MANUAL TRIGGER] Starting immediate contract expiry check...',
    );
    await this.checkContractExpiry(true);
  }

  /**
   * فحص يومي للعقود التي ستنتهي خلال 30 يوم
   */
  @Cron('*/1 * * * *') // ✅ مؤقتاً: كل دقيقة للاختبار (أعد تغييرها لـ EVERY_DAY_AT_MIDNIGHT بعد التأكد)
  async checkContractExpiry(isManualTest: boolean = false) {
    if (!isManualTest) {
      this.logger.log('⏰ [CRON] Starting daily contract expiry check...');
    }

    const now = this.getStartOfDay(new Date());
    const thirtyDaysLater = new Date(now);
    thirtyDaysLater.setDate(now.getDate() + 30);

    try {
      const contracts = await this.contractRepo
        .createQueryBuilder('contract')
        .leftJoinAndSelect('contract.employee', 'employee')
        .leftJoinAndSelect('employee.user', 'user')
        .where('contract.endDate >= :now', { now })
        .andWhere('contract.endDate <= :future', { future: thirtyDaysLater })
        .getMany();

      this.logger.log(`📊 Found ${contracts.length} contracts expiring soon.`);

      for (const contract of contracts) {
        const contractId = contract.id;

        if (!contract.employee || !contract.employee.user || !contract.endDate)
          continue;

        const endDateObj = this.safeParseDate(contract.endDate);
        if (!endDateObj) continue;

        // منع التكرار
        const existingNotification = await this.notificationRepo.findOne({
          where: {
            referenceId: contract.id,
            category: NotificationCategory.CONTRACT_EXPIRY,
            recipient: { id: contract.employee.user.id },
          },
        });

        if (existingNotification) continue;

        const daysLeft = Math.ceil(
          (endDateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        try {
          // ✅ FIX: إضافة actionUrl و metadata للتوجيه الذكي وعرض بيانات الموظف
          await this.notificationsService.create({
            recipientId: contract.employee.user.id,
            title: 'تنبيه: انتهاء العقد قريباً',
            message: `عقدك سينتهي خلال ${daysLeft} يوم (${endDateObj.toLocaleDateString('ar-SA')})`,
            category: NotificationCategory.CONTRACT_EXPIRY,
            referenceId: contract.id,
            referenceType: 'contract',
            actionUrl: `/dashboard/contracts/${contract.id}`, // ✅ رابط مباشر لصفحة العقد
            metadata: {
              employeeName: contract.employee.fullName,
              employeeCode: contract.employee.employeeCode,
              daysLeft: daysLeft,
            },
          });

          this.logger.log(
            `✅ Sent expiry notification for contract ${contractId}`,
          );
        } catch (error) {
          this.logger.error(
            ` Failed to create notification for contract ${contractId}:`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error('❌ Critical error in checkContractExpiry:', error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkProbationEnd() {
    this.logger.log('🔍 Starting probation end check...');
    const now = this.getStartOfDay(new Date());
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(now.getDate() + 7);

    try {
      const contracts = await this.contractRepo
        .createQueryBuilder('contract')
        .leftJoinAndSelect('contract.employee', 'employee')
        .leftJoinAndSelect('employee.user', 'user')
        .where('contract.probationEndDate >= :now', { now })
        .andWhere('contract.probationEndDate <= :future', {
          future: sevenDaysLater,
        })
        .getMany();

      for (const contract of contracts) {
        if (!contract.employee?.user?.id || !contract.probationEndDate)
          continue;
        const probationDateObj = this.safeParseDate(contract.probationEndDate);
        if (!probationDateObj) continue;

        const existingNotification = await this.notificationRepo.findOne({
          where: {
            referenceId: contract.employee.id,
            category: NotificationCategory.PROBATION_END,
            recipient: { id: contract.employee.user.id },
          },
        });
        if (existingNotification) continue;

        const daysLeft = Math.ceil(
          (probationDateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        await this.notificationsService.create({
          recipientId: contract.employee.user.id,
          title: 'تنبيه: انتهاء فترة التجربة',
          message: `ستنتهي فترة تجربتك خلال ${daysLeft} يوم`,
          category: NotificationCategory.PROBATION_END,
          referenceId: contract.employee.id,
          referenceType: 'employee',
          actionUrl: `/dashboard/employees/${contract.employee.id}`,
        });
        this.logger.log(
          `✅ Sent probation end notification for employee ${contract.employee.id}`,
        );
      }
    } catch (error) {
      this.logger.error(' Error in checkProbationEnd:', error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkIqamaExpiry() {
    this.logger.log('🔍 Starting iqama expiry check...');
    const now = this.getStartOfDay(new Date());
    const thirtyDaysLater = new Date(now);
    thirtyDaysLater.setDate(now.getDate() + 30);

    try {
      const contracts = await this.contractRepo
        .createQueryBuilder('contract')
        .leftJoinAndSelect('contract.employee', 'employee')
        .leftJoinAndSelect('employee.user', 'user')
        .where('employee.iqamaExpiryDate IS NOT NULL')
        .andWhere('employee.iqamaExpiryDate >= :now', { now })
        .andWhere('employee.iqamaExpiryDate <= :future', {
          future: thirtyDaysLater,
        })
        .getMany();

      for (const contract of contracts) {
        if (!contract.employee?.user?.id || !contract.employee.iqamaExpiryDate)
          continue;
        const iqamaDateObj = this.safeParseDate(
          contract.employee.iqamaExpiryDate,
        );
        if (!iqamaDateObj) continue;

        const existingNotification = await this.notificationRepo.findOne({
          where: {
            referenceId: contract.employee.id,
            category: NotificationCategory.ID_EXPIRY,
            recipient: { id: contract.employee.user.id },
          },
        });
        if (existingNotification) continue;

        const daysLeft = Math.ceil(
          (iqamaDateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        await this.notificationsService.create({
          recipientId: contract.employee.user.id,
          title: 'تنبيه: انتهاء الإقامة قريباً',
          message: `إقامتك ستنتهي خلال ${daysLeft} يوم`,
          category: NotificationCategory.ID_EXPIRY,
          referenceId: contract.employee.id,
          referenceType: 'employee',
          actionUrl: `/dashboard/employees/${contract.employee.id}`,
        });
        this.logger.log(
          `✅ Sent iqama expiry notification for employee ${contract.employee.id}`,
        );
      }
    } catch (error) {
      this.logger.error('❌ Error in checkIqamaExpiry:', error);
    }
  }
}
