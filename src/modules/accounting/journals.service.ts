// src/modules/accounting/journals.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { DeliveryAgent } from '../delivery/entities/delivery.entity';
import { Employee } from '../employees/entities/employee.entity';
import { Supplier } from '../purchasing/entities/supplier.entity';
import { Customer } from '../sales/entities/customer.entity';
import { JournalSource, PartyType } from './accounting.constants';
import {
  CreateJournalEntryDto,
  JournalQueryDto,
  ReverseJournalEntryDto,
} from './dto/accounting.dto';
import { JournalEntry, JournalLine } from './entities/accounting.entity';
import { LedgerService } from './ledger.service';
import { SetupService } from './setup.service';

/** سطر قيد للعرض: بحسابه، وفرعه، واسم طرفه */
export interface JournalLineView extends JournalLine {
  accountCode: string;
  accountName: string;
  branchName: string | null;
  partyName: string | null;
}

export interface JournalEntryView extends Omit<JournalEntry, 'lines'> {
  lines: JournalLineView[];
}

@Injectable()
export class JournalsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerService,
    private readonly setup: SetupService,
  ) {}

  async findAll(
    tenantId: string,
    query: JournalQueryDto,
  ): Promise<Paginated<JournalEntry>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.dataSource
      .getRepository(JournalEntry)
      .createQueryBuilder('e')
      .where('e.tenantId = :tenantId', { tenantId });
    if (query.from) qb.andWhere('e.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('e.date <= :to', { to: query.to });
    if (query.sourceType) {
      qb.andWhere('e.sourceType = :sourceType', {
        sourceType: query.sourceType,
      });
    }
    if (query.accountId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM journal_lines l
                  WHERE l."entryId" = e.id AND l."accountId" = :accountId)`,
        { accountId: query.accountId },
      );
    }
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        '(e.number ILIKE :like OR e.description ILIKE :like OR e.sourceRef ILIKE :like)',
        { like: `%${search}%` },
      );
    }
    const [data, total] = await qb
      .orderBy('e.date', 'DESC')
      .addOrderBy('e.number', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<JournalEntryView> {
    const entry = await this.dataSource.manager.findOne(JournalEntry, {
      where: { id, tenantId },
    });
    if (!entry) throw new NotFoundException('القيد غير موجود');
    const lines = await this.dataSource.manager.find(JournalLine, {
      where: { entryId: id },
      relations: ['account'],
      withDeleted: true,
      order: { lineOrder: 'ASC' },
    });
    const parties = await this.partyNames(
      this.dataSource.manager,
      tenantId,
      lines,
    );
    const branches = await this.branchNames(tenantId, lines);
    return {
      ...entry,
      lines: lines.map((line) => ({
        ...line,
        accountCode: line.account?.code ?? '',
        accountName: line.account?.name ?? '',
        account: undefined,
        branchName: line.branchId
          ? (branches.get(line.branchId) ?? null)
          : null,
        partyName: line.partyId
          ? (parties.get(`${line.partyType}:${line.partyId}`) ?? null)
          : null,
      })),
    };
  }

  /** قيد يدوي: كل سطر طرف واحد، والطرف (إن وُجد) من الشركة */
  async create(
    tenantId: string,
    dto: CreateJournalEntryDto,
    userId?: string,
  ): Promise<JournalEntryView> {
    for (const [index, line] of dto.lines.entries()) {
      const debit = line.debit ?? 0;
      const credit = line.credit ?? 0;
      if (debit > 0 === credit > 0) {
        throw new BadRequestException(
          `السطر ${index + 1}: أدخل مبلغاً مديناً أو دائناً (واحداً فقط)`,
        );
      }
    }
    const settings = await this.setup.settingsOf(tenantId);
    const entry = await this.dataSource.transaction(async (manager) => {
      await this.assertRefs(manager, tenantId, dto);
      const posted = await this.ledger.post(
        manager,
        {
          tenantId,
          date: dto.date,
          description: dto.description.trim(),
          sourceType: JournalSource.MANUAL,
          lines: dto.lines.map((line) => ({
            accountId: line.accountId,
            debit: line.debit ?? 0,
            credit: line.credit ?? 0,
            description: line.description?.trim() || null,
            branchId: line.branchId ?? null,
            partyType: line.partyType ?? null,
            partyId: line.partyType ? (line.partyId ?? null) : null,
          })),
          createdById: userId ?? null,
          automatic: false,
        },
        settings,
      );
      if (!posted) throw new BadRequestException('القيد بلا مبالغ');
      return posted;
    });
    return this.findOne(entry.id, tenantId);
  }

  async reverse(
    tenantId: string,
    id: string,
    dto: ReverseJournalEntryDto,
    userId?: string,
  ): Promise<JournalEntryView> {
    await this.setup.settingsOf(tenantId);
    const reversal = await this.ledger.reverse(tenantId, id, dto.date, userId);
    return this.findOne(reversal.id, tenantId);
  }

  /** أسماء الأطراف في الأسطر: "type:id" ← الاسم */
  async partyNames(
    manager: EntityManager,
    tenantId: string,
    lines: { partyType?: string | null; partyId?: string | null }[],
  ): Promise<Map<string, string>> {
    const ids = (type: PartyType) => [
      ...new Set(
        lines
          .filter((l) => l.partyType === type && l.partyId)
          .map((l) => l.partyId as string),
      ),
    ];
    const names = new Map<string, string>();
    const load = async (
      type: PartyType,
      fetch: (list: string[]) => Promise<{ id: string; label: string }[]>,
    ) => {
      const list = ids(type);
      if (!list.length) return;
      for (const row of await fetch(list))
        names.set(`${type}:${row.id}`, row.label);
    };
    await load(PartyType.CUSTOMER, async (list) =>
      (
        await manager.find(Customer, {
          where: { tenantId, id: In(list) },
          withDeleted: true,
          select: ['id', 'name', 'code'],
        })
      ).map((c) => ({ id: c.id, label: `${c.name} (${c.code})` })),
    );
    await load(PartyType.SUPPLIER, async (list) =>
      (
        await manager.find(Supplier, {
          where: { tenantId, id: In(list) },
          withDeleted: true,
          select: ['id', 'name', 'code'],
        })
      ).map((s) => ({ id: s.id, label: `${s.name} (${s.code})` })),
    );
    await load(PartyType.EMPLOYEE, async (list) =>
      (
        await manager.find(Employee, {
          where: { tenantId, id: In(list) },
          withDeleted: true,
          select: ['id', 'fullName'],
        })
      ).map((e) => ({ id: e.id, label: e.fullName })),
    );
    await load(PartyType.COURIER, async (list) =>
      (
        await manager.find(DeliveryAgent, {
          where: { tenantId, id: In(list) },
          withDeleted: true,
          select: ['id', 'name'],
        })
      ).map((a) => ({ id: a.id, label: a.name })),
    );
    return names;
  }

  private async branchNames(
    tenantId: string,
    lines: { branchId?: string | null }[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(lines.map((l) => l.branchId).filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await this.dataSource.query<{ id: string; name: string }[]>(
      `SELECT "id", "name" FROM branches WHERE "tenantId" = $1 AND "id" = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** الفروع والأطراف في القيد اليدوي من نفس الشركة */
  private async assertRefs(
    manager: EntityManager,
    tenantId: string,
    dto: CreateJournalEntryDto,
  ): Promise<void> {
    const branchIds = [
      ...new Set(dto.lines.map((l) => l.branchId).filter(Boolean)),
    ] as string[];
    if (branchIds.length) {
      const [{ count }] = await manager.query<{ count: string }[]>(
        `SELECT COUNT(*) AS "count" FROM branches
          WHERE "tenantId" = $1 AND "id" = ANY($2::uuid[]) AND "deletedAt" IS NULL`,
        [tenantId, branchIds],
      );
      if (Number(count) !== branchIds.length) {
        throw new BadRequestException('فرع في القيد غير موجود');
      }
    }
    const withParty = dto.lines.filter((l) => l.partyType && l.partyId);
    if (withParty.length) {
      const names = await this.partyNames(manager, tenantId, withParty);
      const missing = withParty.find(
        (l) => !names.has(`${l.partyType}:${l.partyId}`),
      );
      if (missing) throw new BadRequestException('طرف في القيد غير موجود');
    }
  }
}
