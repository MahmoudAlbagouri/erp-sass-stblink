// src/modules/notifications/strategies/expiry-check.strategy.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Contract } from '../../contracts/entities/contract.entity';
import { NotificationsService } from '../notifications.service';
import { NotificationCategory } from '../entities/notification.entity';

@Injectable()
export class ExpiryCheckStrategy {
  private readonly logger = new Logger(ExpiryCheckStrategy.name);

  constructor(
    @InjectRepository(Contract)
    private contractRepo: Repository<Contract>,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * فحص يومي للعقود التي ستنتهي خلال 30 يوم
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkContractExpiry() {
    this.logger.log('Checking contract expiries...');
    const now = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(now.getDate() + 30);

    const contracts = await this.contractRepo.find({
      where: {
        endDate: Between(now, thirtyDaysLater),
      },
      relations: ['employee', 'employee.user'],
    });

    for (const contract of contracts) {
      if (contract.employee?.user && contract.endDate) {
        const daysLeft = Math.ceil(
          (contract.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        await this.notificationsService.create({
          recipientId: contract.employee.user.id,
          title: 'تنبيه: انتهاء العقد قريباً',
          message: `عقدك سينتهي خلال ${daysLeft} يوم`,
          category: NotificationCategory.CONTRACT_EXPIRY,
          referenceId: contract.id,
          referenceType: 'contract',
        });
      }
    }

    this.logger.log(
      `Found ${contracts.length} contracts expiring within 30 days`,
    );
  }

  /**
   * فحص يومي لفترة التجربة التي ستنتهي خلال 7 أيام
   * ✅ probationEndDate موجود في Contract وليس Employee
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkProbationEnd() {
    this.logger.log('Checking probation periods...');
    const now = new Date();
    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(now.getDate() + 7);

    // ✅ البحث يتم الآن في Contract حيث يوجد الحقل فعلياً
    const contracts = await this.contractRepo.find({
      where: {
        probationEndDate: Between(now, sevenDaysLater),
      },
      relations: ['employee', 'employee.user'],
    });

    for (const contract of contracts) {
      if (contract.employee?.user && contract.probationEndDate) {
        const daysLeft = Math.ceil(
          (contract.probationEndDate.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        await this.notificationsService.create({
          recipientId: contract.employee.user.id,
          title: 'تنبيه: انتهاء فترة التجربة',
          message: `ستنتهي فترة تجربتك خلال ${daysLeft} يوم`,
          category: NotificationCategory.PROBATION_END,
          referenceId: contract.employee.id,
          referenceType: 'employee',
        });
      }
    }

    this.logger.log(
      `Found ${contracts.length} probation periods ending within 7 days`,
    );
  }

  /**
   * ✅ جديد: فحص انتهاء الهوية/الإقامة
   * iqamaExpiryDate موجود في Employee Entity
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkIqamaExpiry() {
    this.logger.log('Checking iqama expiry dates...');
    const now = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(now.getDate() + 30);

    // هنا نحتاج لاستيراد Employee Repository
    // لكن بما أننا نبحث عن حقل في Employee، سنضيفه للـ constructor
    // أو يمكننا استخدام Query Builder عبر Contract → Employee

    const contracts = await this.contractRepo
      .createQueryBuilder('contract')
      .leftJoinAndSelect('contract.employee', 'employee')
      .leftJoinAndSelect('employee.user', 'user')
      .where('employee.iqamaExpiryDate BETWEEN :now AND :future', {
        now,
        future: thirtyDaysLater,
      })
      .getMany();

    for (const contract of contracts) {
      if (contract.employee?.user && contract.employee.iqamaExpiryDate) {
        const daysLeft = Math.ceil(
          (contract.employee.iqamaExpiryDate.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        await this.notificationsService.create({
          recipientId: contract.employee.user.id,
          title: 'تنبيه: انتهاء الإقامة قريباً',
          message: `إقامتك ستنتهي خلال ${daysLeft} يوم`,
          category: NotificationCategory.ID_EXPIRY,
          referenceId: contract.employee.id,
          referenceType: 'employee',
        });
      }
    }

    this.logger.log(`Found ${contracts.length} iqamas expiring within 30 days`);
  }
}
