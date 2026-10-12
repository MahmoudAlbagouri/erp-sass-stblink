// src/modules/sales/sales-settings.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateSalesSettingsDto } from './dto/sales.dto';
import { SalesSettings } from './entities/sales-settings.entity';

@Injectable()
export class SalesSettingsService {
  constructor(
    @InjectRepository(SalesSettings)
    private readonly settings: Repository<SalesSettings>,
  ) {}

  /** إعدادات الشركة — تُنشأ فارغة عند أول قراءة */
  async get(tenantId: string): Promise<SalesSettings> {
    const existing = await this.settings.findOne({ where: { tenantId } });
    if (existing) return existing;

    // الفهرس الفريد يحسم طلبين متزامنين: الثاني لا يضيف شيئاً
    await this.settings
      .createQueryBuilder()
      .insert()
      .values({ tenantId })
      .orIgnore()
      .execute();
    return this.settings.findOneOrFail({ where: { tenantId } });
  }

  async update(
    tenantId: string,
    dto: UpdateSalesSettingsDto,
  ): Promise<SalesSettings> {
    const current = await this.get(tenantId);
    Object.assign(current, dto);
    return this.settings.save(current);
  }
}
