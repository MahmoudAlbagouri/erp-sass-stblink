// src/modules/settlements/settlements.service.ts

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Settlement } from './entities/settlement.entity';
import { ConfirmSettlementDto } from './dto/confirm-settlement.dto';
import { LeaveBalance } from '../leaves/entities/leave-balance.entity';
import { SalariesService } from '../salaries/salaries.service';

/** شكل الرد المُعاد من دالة الحساب (بدون حفظ في DB) */
export interface SettlementPreview {
  employeeId: string;
  year: number;
  unusedLeaveDays: number;
  dailyRate: number;
  totalAmount: number;
}

@Injectable()
export class SettlementsService {
  constructor(
    @InjectRepository(Settlement)
    private readonly repo: Repository<Settlement>,

    @InjectRepository(LeaveBalance)
    private readonly balanceRepo: Repository<LeaveBalance>,

    private readonly salariesService: SalariesService,

    /** نحتاج DataSource لتشغيل QueryRunner (Transaction) */
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────
  // 1. حساب المستحقات (للعرض فقط، لا يُحفظ شيء)
  // ─────────────────────────────────────────────
  async calculateSettlement(
    employeeId: string,
    tenantId: string,
  ): Promise<SettlementPreview> {
    const year = new Date().getFullYear();

    // ── جلب رصيد الإجازات للسنة الحالية ──
    const balance = await this.balanceRepo.findOne({
      where: { employeeId, tenantId, year },
    });

    if (!balance) {
      throw new NotFoundException(
        `لم يُعثر على رصيد إجازات للموظف في سنة ${year}`,
      );
    }

    const unusedLeaveDays = balance.totalAllowance - balance.consumedDays;

    if (unusedLeaveDays < 0) {
      throw new BadRequestException(
        'بيانات رصيد الإجازات غير صحيحة: الأيام المستهلكة تتجاوز المخصصة',
      );
    }

    // ── جلب الراتب الفعلي ──
    const salary = await this.salariesService.findByEmployee(
      employeeId,
      tenantId,
    );

    if (!salary) {
      throw new NotFoundException('لم يُعثر على راتب مسجّل لهذا الموظف');
    }

    const dailyRate = Number(salary.totalSalary) / 30;
    const totalAmount = unusedLeaveDays * dailyRate;

    return {
      employeeId,
      year,
      unusedLeaveDays,
      dailyRate: parseFloat(dailyRate.toFixed(2)),
      totalAmount: parseFloat(totalAmount.toFixed(2)),
    };
  }

  // ─────────────────────────────────────────────
  // 2. تأكيد التسوية وأرشفتها (داخل Transaction)
  // ─────────────────────────────────────────────
  async confirmSettlement(
    dto: ConfirmSettlementDto,
    tenantId: string,
  ): Promise<Settlement> {
    // منع إنشاء تسوية مكررة لنفس الموظف في نفس السنة
    const settlementYear = new Date(dto.settlementDate).getFullYear();
    const duplicate = await this.repo.findOne({
      where: { employeeId: dto.employeeId, tenantId },
    });

    if (duplicate) {
      throw new BadRequestException(
        'يوجد تسوية مسجّلة مسبقاً لهذا الموظف. لا يمكن تسجيل تسويتين.',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // ── أ. صفّر رصيد الإجازات للسنة المعنية ──
      const balance = await queryRunner.manager.findOne(LeaveBalance, {
        where: {
          employeeId: dto.employeeId,
          tenantId,
          year: settlementYear,
        },
      });

      if (balance) {
        balance.consumedDays = balance.totalAllowance; // رصيد متبقٍ = 0
        await queryRunner.manager.save(LeaveBalance, balance);
      }
      // إذا لم يوجد رصيد من الأساس فلا شيء يُصفَّر

      // ── ب. أرشف سجل التسوية ──
      const settlement = queryRunner.manager.create(Settlement, {
        ...dto,
        settlementDate: new Date(dto.settlementDate),
        tenantId,
      });
      const saved = await queryRunner.manager.save(Settlement, settlement);

      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ─────────────────────────────────────────────
  // 3. جلب كل التسويات (للعرض في الأرشيف)
  // ─────────────────────────────────────────────
  async findAll(tenantId: string): Promise<Settlement[]> {
    return await this.repo.find({
      where: { tenantId },
      relations: { employee: true },
      order: { createdAt: 'DESC' },
    });
  }

  // ─────────────────────────────────────────────
  // 4. جلب تسوية موظف محدد
  // ─────────────────────────────────────────────
  async findByEmployee(
    employeeId: string,
    tenantId: string,
  ): Promise<Settlement | null> {
    return await this.repo.findOne({
      where: { employeeId, tenantId },
      relations: { employee: true },
    });
  }
}
