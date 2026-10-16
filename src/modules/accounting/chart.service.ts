// src/modules/accounting/chart.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateAccountDto, UpdateAccountDto } from './dto/accounting.dto';
import { Account, JournalLine } from './entities/accounting.entity';
import { buildChartTemplate } from './templates/chart-templates';

const NOT_FOUND = 'الحساب غير موجود';

/**
 * شجرة الحسابات: الحسابات الرئيسية الخمسة ثابتة، وتحتها ما تشاء الشركة من
 * مستويات. القيود على الحسابات الفرعية وحدها. حساب عليه قيود لا يُحذف (يُوقف)،
 * وحساب النظام لا يُحذف ولا يُوقف.
 */
@Injectable()
export class ChartService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    private readonly dataSource: DataSource,
  ) {}

  /** الشجرة كاملة مرتبة بالكود (الأب قبل أبنائه) — الواجهة تبنيها */
  findAll(tenantId: string): Promise<Account[]> {
    return this.accounts.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  async findOne(id: string, tenantId: string): Promise<Account> {
    const account = await this.accounts.findOne({ where: { id, tenantId } });
    if (!account) throw new NotFoundException(NOT_FOUND);
    return account;
  }

  async create(dto: CreateAccountDto, tenantId: string): Promise<Account> {
    const parent = await this.findOne(dto.parentId, tenantId);
    if (!parent.isGroup) {
      throw new BadRequestException(
        `"${parent.name}" حساب فرعي — حوّله لتجميعي أولاً لتضيف تحته`,
      );
    }
    const code = dto.code?.trim() || (await this.nextChildCode(parent));
    this.assertCodeUnder(code, parent);
    await this.assertCodeFree(tenantId, code);

    return this.accounts.save(
      this.accounts.create({
        tenantId,
        code,
        name: dto.name.trim(),
        nameEn: dto.nameEn?.trim() || null,
        type: parent.type,
        parentId: parent.id,
        isGroup: dto.isGroup ?? false,
        description: dto.description?.trim() || null,
      }),
    );
  }

  async update(
    id: string,
    dto: UpdateAccountDto,
    tenantId: string,
  ): Promise<Account> {
    const account = await this.findOne(id, tenantId);
    if (
      !account.parentId &&
      (dto.parentId || dto.code || dto.isGroup === false)
    ) {
      throw new BadRequestException(
        'الحسابات الرئيسية الخمسة ثابتة: يُعدَّل اسمها فقط',
      );
    }
    const hasChildren = await this.accounts.exists({
      where: { tenantId, parentId: id },
    });
    const hasLines = await this.hasLines(id);
    const changes: Partial<Account> = {};

    // ─── النقل لأب آخر ───
    let parent = account.parentId
      ? await this.findOne(account.parentId, tenantId)
      : null;
    if (dto.parentId && dto.parentId !== account.parentId) {
      if (hasChildren) {
        throw new BadRequestException(
          'لا يُنقل حساب تحته حسابات — انقل حساباته أولاً',
        );
      }
      const target = await this.findOne(dto.parentId, tenantId);
      if (!target.isGroup) {
        throw new BadRequestException(`"${target.name}" ليس حساباً تجميعياً`);
      }
      if (target.type !== account.type) {
        throw new BadRequestException(
          'الحساب يبقى تحت نوعه (أصل تحت الأصول، مصروف تحت المصروفات…)',
        );
      }
      parent = target;
      changes.parentId = target.id;
      changes.code = dto.code?.trim() || (await this.nextChildCode(target));
    }

    // ─── الكود ───
    const code = changes.code ?? dto.code?.trim();
    if (code && code !== account.code) {
      if (hasChildren) {
        throw new BadRequestException(
          'كود حساب تحته حسابات لا يتغير (أكوادهم تبدأ به)',
        );
      }
      if (parent) this.assertCodeUnder(code, parent);
      await this.assertCodeFree(tenantId, code, id);
      changes.code = code;
    }

    // ─── تجميعي / فرعي ───
    if (dto.isGroup !== undefined && dto.isGroup !== account.isGroup) {
      if (dto.isGroup && hasLines) {
        throw new BadRequestException(
          'عليه قيود: لا يتحول لتجميعي — أضف حساباً فرعياً جديداً بدلاً منه',
        );
      }
      if (!dto.isGroup && hasChildren) {
        throw new BadRequestException('تحته حسابات: لا يتحول لفرعي');
      }
      if (dto.isGroup && account.systemKey) {
        throw new BadRequestException(
          'حساب نظام يُرحَّل إليه تلقائياً: يبقى فرعياً',
        );
      }
      changes.isGroup = dto.isGroup;
    }

    // ─── الإيقاف ───
    if (dto.isActive !== undefined && dto.isActive !== account.isActive) {
      if (!dto.isActive && account.systemKey) {
        throw new BadRequestException(
          'حساب نظام يُرحَّل إليه تلقائياً: لا يُوقف',
        );
      }
      changes.isActive = dto.isActive;
    }

    if (dto.name !== undefined) changes.name = dto.name.trim();
    if (dto.nameEn !== undefined) changes.nameEn = dto.nameEn?.trim() || null;
    if (dto.description !== undefined) {
      changes.description = dto.description?.trim() || null;
    }

    if (Object.keys(changes).length) {
      await this.accounts.update({ id, tenantId }, changes);
    }
    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const account = await this.findOne(id, tenantId);
    if (!account.parentId) {
      throw new BadRequestException('الحسابات الرئيسية الخمسة لا تُحذف');
    }
    if (account.systemKey) {
      throw new BadRequestException(
        'حساب نظام يُرحَّل إليه تلقائياً: لا يُحذف (غيّر اسمه إن شئت)',
      );
    }
    if (await this.accounts.exists({ where: { tenantId, parentId: id } })) {
      throw new ConflictException('تحته حسابات — احذفها أو انقلها أولاً');
    }
    if (await this.hasLines(id)) {
      throw new ConflictException('عليه قيود: لا يُحذف — أوقفه بدلاً من ذلك');
    }
    await this.accounts.softDelete({ id, tenantId });
  }

  /** الكود التالي لابن جديد: كود الأب + رقمان (110101، 110102…) */
  async nextChildCode(parent: Account): Promise<string> {
    const rows = await this.accounts.manager.query<{ code: string }[]>(
      `SELECT "code" FROM accounts
        WHERE "tenantId" = $1 AND "parentId" = $2 AND "deletedAt" IS NULL`,
      [parent.tenantId, parent.id],
    );
    const width = parent.code.length >= 2 ? 2 : 1;
    let next = 1;
    for (const row of rows) {
      const tail = Number(row.code.slice(parent.code.length));
      if (Number.isInteger(tail) && tail >= next) next = tail + 1;
    }
    const code = `${parent.code}${String(next).padStart(width, '0')}`;
    if (code.length > 20) {
      throw new BadRequestException('وصلت الشجرة لأقصى عمق للأكواد');
    }
    return code;
  }

  /**
   * ينشئ شجرة الدولة الجاهزة داخل معاملة التفعيل (الأب قبل أبنائه). لا يفعل
   * شيئاً إن كانت للشركة شجرة.
   */
  async seedTemplate(
    manager: EntityManager,
    tenantId: string,
    countryCode: string,
  ): Promise<void> {
    if (await manager.exists(Account, { where: { tenantId } })) return;
    const ids = new Map<string, string>();
    for (const template of buildChartTemplate(countryCode)) {
      const saved = await manager.save(
        manager.create(Account, {
          tenantId,
          code: template.code,
          name: template.name,
          nameEn: template.nameEn,
          type: template.type,
          isGroup: template.isGroup,
          systemKey: template.systemKey ?? null,
          parentId: template.parentCode ? ids.get(template.parentCode) : null,
        }),
      );
      ids.set(template.code, saved.id);
    }
  }

  private hasLines(accountId: string): Promise<boolean> {
    return this.dataSource.manager.exists(JournalLine, {
      where: { accountId },
    });
  }

  private assertCodeUnder(code: string, parent: Account): void {
    if (!/^[0-9]{1,20}$/.test(code)) {
      throw new BadRequestException('الكود أرقام فقط (حتى 20 رقماً)');
    }
    if (!code.startsWith(parent.code) || code.length <= parent.code.length) {
      throw new BadRequestException(
        `كود الحساب يبدأ بكود أبيه "${parent.code}" ويزيد عليه`,
      );
    }
  }

  private async assertCodeFree(
    tenantId: string,
    code: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await this.accounts.findOne({ where: { tenantId, code } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException(
        `الكود ${code} مستخدم لحساب "${existing.name}"`,
      );
    }
  }
}
