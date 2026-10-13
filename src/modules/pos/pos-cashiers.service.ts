// src/modules/pos/pos-cashiers.service.ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CreatePosCashierDto, UpdatePosCashierDto } from './dto/pos.dto';
import { PosCashier } from './entities/pos.entity';
import { hashPin } from './utils/pos-crypto.util';

/** كاشير كما يخزّنه جهاز الكاشير ليتحقق من رقمه بلا إنترنت */
export interface PosCashierForDevice {
  id: string;
  name: string;
  canReturn: boolean;
  pinSalt: string;
  pinHash: string;
  pinIterations: number;
}

/**
 * كاشيرات الشركة وأرقامهم السرية. الرقم نفسه لا يُحفظ ولا يُعاد: مشتقّه فقط،
 * وهو ما ينزل للأجهزة (انظر pos-crypto.util).
 */
@Injectable()
export class PosCashiersService {
  constructor(
    @InjectRepository(PosCashier)
    private readonly cashiers: Repository<PosCashier>,
  ) {}

  findAll(tenantId: string): Promise<PosCashier[]> {
    return this.cashiers.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async findOne(id: string, tenantId: string): Promise<PosCashier> {
    const cashier = await this.cashiers.findOne({ where: { id, tenantId } });
    if (!cashier) throw new NotFoundException('الكاشير غير موجود');
    return cashier;
  }

  /** للتحقق من عملية رفعها جهاز: يشمل من حُذف بعد أن فتح ورديته */
  findForOperation(id: string, tenantId: string): Promise<PosCashier | null> {
    return this.cashiers.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
  }

  /** الكاشيرات الفعّالون بمشتقات أرقامهم — لتنزيلها على جهاز مربوط فقط */
  async findForDevice(tenantId: string): Promise<PosCashierForDevice[]> {
    const rows = await this.cashiers
      .createQueryBuilder('cashier')
      .addSelect([
        'cashier.pinSalt',
        'cashier.pinHash',
        'cashier.pinIterations',
      ])
      .where('cashier.tenantId = :tenantId', { tenantId })
      .andWhere('cashier.isActive = true')
      .orderBy('cashier.name', 'ASC')
      .getMany();

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      canReturn: c.canReturn,
      pinSalt: c.pinSalt,
      pinHash: c.pinHash,
      pinIterations: c.pinIterations,
    }));
  }

  async create(
    dto: CreatePosCashierDto,
    tenantId: string,
  ): Promise<PosCashier> {
    const name = dto.name.trim();
    await this.assertNameFree(name, tenantId);

    const saved = await this.cashiers.save(
      this.cashiers.create({
        tenantId,
        name,
        canReturn: dto.canReturn ?? false,
        isActive: dto.isActive ?? true,
        ...hashPin(dto.pin),
      }),
    );
    return this.findOne(saved.id, tenantId);
  }

  async update(
    id: string,
    dto: UpdatePosCashierDto,
    tenantId: string,
  ): Promise<PosCashier> {
    const cashier = await this.findOne(id, tenantId);
    const couldReturn = cashier.canReturn && cashier.isActive;

    const name = dto.name?.trim();
    if (name && name !== cashier.name) {
      await this.assertNameFree(name, tenantId, id);
      cashier.name = name;
    }
    if (dto.canReturn !== undefined) cashier.canReturn = dto.canReturn;
    if (dto.isActive !== undefined) cashier.isActive = dto.isActive;
    if (dto.pin) Object.assign(cashier, hashPin(dto.pin));

    const canReturnNow = cashier.canReturn && cashier.isActive;
    if (couldReturn && !canReturnNow) cashier.returnRevokedAt = new Date();
    else if (canReturnNow) cashier.returnRevokedAt = null;

    await this.cashiers.save(cashier);
    return this.findOne(id, tenantId);
  }

  /** حذف منطقي: ورديات الكاشير السابقة تبقى باسمه */
  async remove(id: string, tenantId: string): Promise<void> {
    const cashier = await this.findOne(id, tenantId);
    if (cashier.canReturn && cashier.isActive) {
      await this.cashiers.update({ id }, { returnRevokedAt: new Date() });
    }
    await this.cashiers.softRemove(cashier);
  }

  private async assertNameFree(
    name: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.cashiers.findOne({
      where: { tenantId, name, ...(excludeId ? { id: Not(excludeId) } : {}) },
    });
    if (duplicate) {
      throw new ConflictException(`يوجد كاشير آخر بالاسم "${name}"`);
    }
  }
}

/**
 * هل يُقبل مرتجع سجّله هذا الكاشير في تلك اللحظة؟ يملك الصلاحية الآن، أو
 * سُحبت منه بعد أن سجّل الجهاز (غير المتصل) المرتجع.
 */
export function cashierCouldReturn(
  cashier: PosCashier,
  issuedAt: Date,
): boolean {
  if (cashier.canReturn && cashier.isActive && !cashier.deletedAt) return true;
  return !!cashier.returnRevokedAt && issuedAt <= cashier.returnRevokedAt;
}
