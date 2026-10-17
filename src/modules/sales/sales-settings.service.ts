// src/modules/sales/sales-settings.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { defaultVatRegistered } from '../../common/utils/vat.util';
import { UpdateSalesSettingsDto } from './dto/sales.dto';
import { PosOptions, SalesSettings } from './entities/sales-settings.entity';

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

    // الفهرس الفريد يحسم طلبين متزامنين: الثاني لا يضيف شيئاً. التسجيل في
    // الضريبة يبدأ حسب الدولة (لا ضريبة في الكويت وقطر…)
    await this.settings
      .createQueryBuilder()
      .insert()
      .values({
        tenantId,
        vatRegistered: await defaultVatRegistered(
          this.settings.manager,
          tenantId,
        ),
      })
      .orIgnore()
      .execute();
    return this.settings.findOneOrFail({ where: { tenantId } });
  }

  async update(
    tenantId: string,
    dto: UpdateSalesSettingsDto,
  ): Promise<SalesSettings> {
    const current = await this.get(tenantId);
    // التسجيل في الضريبة يعني رقماً ضريبياً على كل فاتورة ورمز QR بها
    const registering = dto.vatRegistered === true && !current.vatRegistered;
    const taxNumber =
      dto.taxNumber !== undefined ? dto.taxNumber : current.taxNumber;
    if (registering && !taxNumber) {
      throw new BadRequestException(
        'أدخل الرقم الضريبي للمنشأة قبل تفعيل التسجيل في ضريبة القيمة المضافة',
      );
    }
    const { posOptions, ...fields } = dto;
    Object.assign(current, fields);
    // دمج لا استبدال: صفحة الفوترة ترسل الميزان والموافقات فقط، فلا تمسح
    // مميزات الشاشة التي تُحفظ من صفحتها
    if (posOptions) {
      current.posOptions = {
        ...current.posOptions,
        // الموافقات من شاشة أقدم قد تأتي بلا priceChange: الافتراضي يكمّلها
        ...(posOptions as Partial<PosOptions>),
      };
    }
    return this.settings.save(current);
  }

  /** يعدّل أجزاء من إعدادات الكاشير ويبقي الباقي كما هو */
  async updatePosOptions(
    tenantId: string,
    patch: Partial<PosOptions>,
  ): Promise<SalesSettings> {
    const current = await this.get(tenantId);
    current.posOptions = { ...current.posOptions, ...patch };
    return this.settings.save(current);
  }
}
