// src/modules/subscriptions/services/subscriptions.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectEntityManager } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { Plan } from '../plans/entities/plan.entity';
import { SubscriptionStatus } from '../../common/enums/subscription.enums';
import { PlansService } from '../plans/plans.service';
import { UpdateSubscriptionStatusDto } from './dto/update-subscription-status.dto';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,

    // ✅ حقن خدمة الخطط بدلاً من الـ Repository مباشرة للاستخدام العام
    private readonly plansService: PlansService,

    @InjectEntityManager()
    private readonly entityManager: EntityManager,
  ) {}

  async createTrialSubscription(
    tenantId: string,
    trialDays: number = 3, // ✅ تم التغيير من 14 إلى 3
    manager?: EntityManager,
  ): Promise<Subscription> {
    const subRepo = manager
      ? manager.getRepository(Subscription)
      : this.subscriptionRepo;

    const freePlan = await this.plansService.getPlanByName('FREE');

    const subscription = subRepo.create({
      tenantId,
      planId: freePlan.id,
      status: SubscriptionStatus.TRIAL,
      startDate: new Date(),
      endDate: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
      autoRenew: false,
    });

    return subRepo.save(subscription);
  }

  async changePlan(
    tenantId: string,
    newPlanId: string,
    options: { durationDays?: number; autoRenew?: boolean } = {},
  ): Promise<Subscription> {
    return this.entityManager.transaction(async (manager) => {
      const subRepo = manager.getRepository(Subscription);

      // ⚠️ هام: داخل الترانزكشن نستخدم manager.getRepository لضمان العزل
      // لا نستخدم plansService هنا لتجنب مشاكل الـ Transaction Context
      const planRepo = manager.getRepository(Plan);

      const newPlan = await planRepo.findOne({ where: { id: newPlanId } });
      if (!newPlan)
        throw new NotFoundException(`الخطة (${newPlanId}) غير موجودة`);

      const currentSub = await subRepo.findOne({
        where: { tenantId },
        order: { created_at: 'DESC' },
      });

      if (currentSub) {
        currentSub.status = SubscriptionStatus.CANCELLED;
        currentSub.cancelledAt = new Date();
        await subRepo.save(currentSub);
      }

      const durationDays = options.durationDays ?? 30;
      const newSub = subRepo.create({
        tenantId,
        planId: newPlan.id,
        status: SubscriptionStatus.ACTIVE,
        startDate: new Date(),
        endDate: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
        autoRenew: options.autoRenew ?? false,
      });

      return subRepo.save(newSub);
    });
  }

  async renew(tenantId: string, extraDays: number = 30): Promise<Subscription> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { tenantId },
      order: { created_at: 'DESC' },
    });

    if (!subscription) throw new NotFoundException('لا يوجد اشتراك لتجديده');

    const baseDate =
      subscription.endDate && subscription.endDate > new Date()
        ? subscription.endDate
        : new Date();

    subscription.endDate = new Date(
      baseDate.getTime() + extraDays * 24 * 60 * 60 * 1000,
    );
    subscription.status = SubscriptionStatus.ACTIVE;

    return this.subscriptionRepo.save(subscription);
  }

  async updateSubscriptionStatus(
    tenantId: string,
    dto: UpdateSubscriptionStatusDto,
  ): Promise<Subscription> {
    return this.entityManager.transaction(async (manager) => {
      const subRepo = manager.getRepository(Subscription);

      const subscription = await subRepo.findOne({
        where: { tenantId },
        order: { created_at: 'DESC' },
      });

      if (!subscription) throw new NotFoundException('لا يوجد اشتراك');

      // ✅ التحقق من صحة التحول بين الحالات
      this.validateStatusTransition(subscription.status, dto.newStatus);

      // تطبيق التغييرات بناءً على الحالة الجديدة
      switch (dto.newStatus) {
        case SubscriptionStatus.ACTIVE:
          subscription.startDate = new Date();
          subscription.endDate = dto.durationDays
            ? new Date(Date.now() + dto.durationDays * 24 * 60 * 60 * 1000)
            : subscription.endDate;
          break;

        case SubscriptionStatus.SUSPENDED:
        case SubscriptionStatus.CANCELLED:
          subscription.cancelledAt = new Date();
          break;

        case SubscriptionStatus.PENDING:
          // إعادة تعيين التواريخ عند التعليق المؤقت
          subscription.endDate = undefined;
          break;
      }

      subscription.status = dto.newStatus;
      return subRepo.save(subscription);
    });
  }

  // ✅ دالة مساعدة لمنع التحولات غير المنطقية
  // src/modules/subscriptions/services/subscriptions.service.ts

  // ✅ دالة مساعدة لمنع التحولات غير المنطقية
  private validateStatusTransition(
    current: SubscriptionStatus,
    next: SubscriptionStatus,
  ) {
    const validTransitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
      [SubscriptionStatus.TRIAL]: [
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.EXPIRED,
        SubscriptionStatus.CANCELLED,
        SubscriptionStatus.SUSPENDED,
        SubscriptionStatus.PENDING, // ✅ السماح بنقل التجربة لانتظار الدفع
      ],
      [SubscriptionStatus.ACTIVE]: [
        SubscriptionStatus.SUSPENDED,
        SubscriptionStatus.CANCELLED,
        SubscriptionStatus.EXPIRED,
        SubscriptionStatus.PENDING,
      ],
      [SubscriptionStatus.PENDING]: [
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.CANCELLED,
        SubscriptionStatus.SUSPENDED,
      ],
      [SubscriptionStatus.SUSPENDED]: [
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.CANCELLED,
        SubscriptionStatus.EXPIRED,
        SubscriptionStatus.PENDING,
      ],
      [SubscriptionStatus.EXPIRED]: [
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PENDING,
        SubscriptionStatus.SUSPENDED,
      ],
      // ✅ التعديل هنا: السماح بالخروج من الإلغاء للتفعيل أو الانتظار
      [SubscriptionStatus.CANCELLED]: [
        SubscriptionStatus.ACTIVE,
        SubscriptionStatus.PENDING,
      ],
    };

    if (!validTransitions[current].includes(next)) {
      throw new BadRequestException(
        `لا يمكن تغيير الحالة من '${current}' إلى '${next}'. التحولات المسموحة: ${validTransitions[current].join(', ')}`,
      );
    }
  }
  async cancel(tenantId: string): Promise<Subscription> {
    // ✅ إعادة استخدام المنطق المركزي بدلاً من تكراره
    return this.updateSubscriptionStatus(tenantId, {
      newStatus: SubscriptionStatus.CANCELLED,
    });
  }
}
