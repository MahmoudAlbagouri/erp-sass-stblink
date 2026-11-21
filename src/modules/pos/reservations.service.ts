// src/modules/pos/reservations.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import {
  dayKeyInZone,
  dayOffsetInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import {
  assertBranchAllowed,
  assertBranchVisible,
  scopedBranchIds,
} from '../branches/branch-scope';
import {
  CreateReservationDto,
  ReservationQueryDto,
  UpdateReservationDto,
} from './dto/restaurant-menu.dto';
import {
  Reservation,
  ReservationStatus,
} from './entities/restaurant-menu.entity';

const NOT_FOUND = 'الحجز غير موجود';

/** الانتقالات المسموحة (والرجوع من الجلوس للحجز لتصحيح ضغطة) */
const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  [ReservationStatus.BOOKED]: [
    ReservationStatus.SEATED,
    ReservationStatus.CANCELLED,
    ReservationStatus.NO_SHOW,
  ],
  [ReservationStatus.SEATED]: [
    ReservationStatus.COMPLETED,
    ReservationStatus.BOOKED,
  ],
  [ReservationStatus.COMPLETED]: [ReservationStatus.SEATED],
  [ReservationStatus.CANCELLED]: [ReservationStatus.BOOKED],
  [ReservationStatus.NO_SHOW]: [ReservationStatus.BOOKED],
};

/**
 * حجوزات الطاولات: من ومتى وكم ضيفاً وأي طاولة، وما حدث فعلاً بوقته (جلس،
 * أنهى، ألغى، لم يحضر) — أساس نسبة عدم الحضور ومدة الجلسة الحقيقية.
 */
@Injectable()
export class ReservationsService {
  constructor(
    @InjectRepository(Reservation)
    private readonly reservations: Repository<Reservation>,
    private readonly dataSource: DataSource,
  ) {}

  async findByDay(
    tenantId: string,
    query: ReservationQueryDto,
  ): Promise<Reservation[]> {
    const timezone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    const day = query.date ?? dayKeyInZone(new Date(), timezone);
    const start = dayOffsetInZone(day, 0, timezone);
    const end = dayOffsetInZone(day, 24 * 60, timezone);
    const qb = this.reservations
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.table', 'table')
      .where('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.reservedAt >= :start AND r.reservedAt < :end', {
        start,
        end,
      });
    if (query.branchId) {
      assertBranchAllowed(query.branchId);
      qb.andWhere('r.branchId = :branchId', { branchId: query.branchId });
    } else {
      const allowed = scopedBranchIds();
      if (allowed) {
        qb.andWhere('(r.branchId IS NULL OR r.branchId IN (:...allowed))', {
          allowed,
        });
      }
    }
    return qb.orderBy('r.reservedAt', 'ASC').getMany();
  }

  async findOne(id: string, tenantId: string): Promise<Reservation> {
    const reservation = await this.reservations.findOne({
      where: { id, tenantId },
      relations: ['table'],
    });
    if (!reservation) throw new NotFoundException(NOT_FOUND);
    assertBranchVisible(reservation.branchId ?? null, NOT_FOUND);
    return reservation;
  }

  async create(
    dto: CreateReservationDto,
    tenantId: string,
    userId?: string,
  ): Promise<Reservation> {
    if (dto.branchId) assertBranchAllowed(dto.branchId);
    const branchId = dto.branchId ?? (await this.tableBranch(dto.tableId));
    const id = await this.dataSource.transaction(async (manager) => {
      await this.assertTableFree(dto, tenantId);
      const saved = await manager.save(
        manager.create(Reservation, {
          tenantId,
          number: await nextDocumentNumber(
            manager,
            'reservations',
            'RS-',
            tenantId,
          ),
          branchId: branchId ?? null,
          tableId: dto.tableId ?? null,
          customerId: dto.customerId ?? null,
          customerName: dto.customerName.trim(),
          phone: dto.phone?.trim() || null,
          guestCount: dto.guestCount,
          reservedAt: new Date(dto.reservedAt),
          durationMinutes: dto.durationMinutes ?? 90,
          source: dto.source ?? 'phone',
          note: dto.note ?? null,
          createdById: userId ?? null,
        }),
      );
      return saved.id;
    });
    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateReservationDto,
    tenantId: string,
  ): Promise<Reservation> {
    const current = await this.findOne(id, tenantId);
    if (current.status !== ReservationStatus.BOOKED) {
      throw new BadRequestException('يُعدَّل الحجز قبل جلوس أصحابه فقط');
    }
    await this.assertTableFree(
      {
        tableId: dto.tableId !== undefined ? dto.tableId : current.tableId,
        reservedAt: dto.reservedAt ?? current.reservedAt.toISOString(),
        durationMinutes: dto.durationMinutes ?? current.durationMinutes,
      },
      tenantId,
      id,
    );
    await this.reservations.update(
      { id, tenantId },
      {
        ...(dto.customerName ? { customerName: dto.customerName.trim() } : {}),
        ...(dto.phone !== undefined
          ? { phone: dto.phone?.trim() || null }
          : {}),
        ...(dto.guestCount !== undefined ? { guestCount: dto.guestCount } : {}),
        ...(dto.reservedAt ? { reservedAt: new Date(dto.reservedAt) } : {}),
        ...(dto.durationMinutes !== undefined
          ? { durationMinutes: dto.durationMinutes }
          : {}),
        ...(dto.tableId !== undefined ? { tableId: dto.tableId } : {}),
        ...(dto.source ? { source: dto.source } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      },
    );
    return this.findOne(id, tenantId);
  }

  async setStatus(
    id: string,
    status: ReservationStatus,
    tenantId: string,
  ): Promise<Reservation> {
    const reservation = await this.findOne(id, tenantId);
    if (reservation.status === status) return reservation;
    if (!TRANSITIONS[reservation.status].includes(status)) {
      throw new BadRequestException('لا يُنقل الحجز لهذه الحالة');
    }
    const now = new Date();
    await this.reservations.update(
      { id, tenantId },
      {
        status,
        seatedAt:
          status === ReservationStatus.SEATED
            ? (reservation.seatedAt ?? now)
            : status === ReservationStatus.BOOKED
              ? null
              : reservation.seatedAt,
        completedAt: status === ReservationStatus.COMPLETED ? now : null,
      },
    );
    return this.findOne(id, tenantId);
  }

  private async tableBranch(tableId?: string | null): Promise<string | null> {
    if (!tableId) return null;
    const [row] = await this.dataSource.query<{ branchId: string | null }[]>(
      `SELECT "branchId" FROM dining_tables WHERE "id" = $1`,
      [tableId],
    );
    return row?.branchId ?? null;
  }

  /** طاولة لا تُحجز مرتين في وقتين متداخلين */
  private async assertTableFree(
    dto: {
      tableId?: string | null;
      reservedAt: string;
      durationMinutes?: number;
    },
    tenantId: string,
    exceptId?: string,
  ): Promise<void> {
    if (!dto.tableId) return;
    const start = new Date(dto.reservedAt);
    const end = new Date(
      start.getTime() + (dto.durationMinutes ?? 90) * 60_000,
    );
    const [clash] = await this.dataSource.query<{ number: string }[]>(
      `SELECT "number" FROM reservations
        WHERE "tenantId" = $1 AND "tableId" = $2 AND "deletedAt" IS NULL
          AND "status" IN ('booked','seated')
          AND "reservedAt" < $4
          AND "reservedAt" + make_interval(mins => "durationMinutes") > $3
          ${exceptId ? `AND "id" <> $5` : ''}
        LIMIT 1`,
      exceptId
        ? [tenantId, dto.tableId, start, end, exceptId]
        : [tenantId, dto.tableId, start, end],
    );
    if (clash) {
      throw new BadRequestException(
        `الطاولة محجوزة في هذا الوقت (الحجز ${clash.number})`,
      );
    }
  }
}
