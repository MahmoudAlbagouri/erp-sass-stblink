// src/modules/farms/farms.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import {
  dayKeyInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import {
  assertBranchAllowed,
  assertBranchVisible,
  restrictToScopedBranches,
} from '../branches/branch-scope';
import { WarehousesService } from '../inventory/warehouses.service';
import {
  BulkFarmUnitsDto,
  CreateFarmDto,
  CreateFarmUnitDto,
  UpdateFarmDto,
  UpdateFarmUnitDto,
  UpdateWaterSourceDto,
  WaterSourceDto,
  WeatherLogDto,
  WeatherQueryDto,
} from './dto/farms.dto';
import {
  Farm,
  FarmUnit,
  FarmUnitKind,
  FarmWaterSource,
  FarmWeatherLog,
  GeoRing,
} from './entities/farm.entity';
import { FarmOperationType } from './entities/farm-enums';
import { FarmOperationStatus } from './entities/farm-work.entity';
import { PlantStatus } from './entities/planting.entity';
import { daysBetween, normalizeRing, ringAreaM2 } from './farm-utils';

const CODE_PREFIX = 'FRM-';
/** أقصى عمق لشجرة المزرعة (قطاع ← حوش ← صف ← ... ) */
export const MAX_UNIT_DEPTH = 6;

export interface FarmSummary extends Farm {
  unitCount: number;
  activePlantings: number;
  livePlants: number;
  openInspections: number;
}

export interface FarmMapUnit {
  id: string;
  parentId: string | null;
  kind: FarmUnitKind;
  name: string;
  code: string | null;
  depth: number;
  boundary: GeoRing | null;
  areaM2: number | null;
  plantings: {
    id: string;
    number: string;
    cropName: string;
    varietyName: string | null;
    plantCount: number;
    expectedHarvestAt: string | null;
  }[];
  livePlants: number;
  infestedPlants: number;
  openInspections: number;
  maxSeverity: number;
  lastIrrigationAt: string | null;
  irrigationIntervalDays: number | null;
  /** فات موعد الري (أو لم يُروَ وله موعد) */
  irrigationDue: boolean;
  /** لا يُحصد قبل هذا اليوم (فترة أمان مبيد سارية) */
  harvestAllowedAt: string | null;
  /** زراعة يُتوقع حصادها خلال أسبوع أو فات موعدها */
  harvestReady: boolean;
}

@Injectable()
export class FarmsService {
  constructor(
    @InjectRepository(Farm) private readonly farms: Repository<Farm>,
    @InjectRepository(FarmUnit) private readonly units: Repository<FarmUnit>,
    @InjectRepository(FarmWaterSource)
    private readonly waterSources: Repository<FarmWaterSource>,
    @InjectRepository(FarmWeatherLog)
    private readonly weather: Repository<FarmWeatherLog>,
    private readonly warehouses: WarehousesService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ المزارع ══════════════════════════

  /** المزارع (في فروع المستخدم) بأرقامها الأساسية */
  async findAll(tenantId: string): Promise<FarmSummary[]> {
    const qb = this.farms
      .createQueryBuilder('f')
      .leftJoinAndSelect('f.branch', 'branch')
      .leftJoinAndSelect('f.warehouse', 'warehouse')
      .where('f.tenantId = :tenantId', { tenantId })
      .orderBy('f.code', 'ASC');
    restrictToScopedBranches(qb, 'f.branchId');
    const farms = await qb.getMany();
    if (!farms.length) return [];

    const ids = farms.map((f) => f.id);
    const rows = await this.dataSource.query<
      {
        farmId: string;
        units: string;
        plantings: string;
        plants: string;
        inspections: string;
      }[]
    >(
      `SELECT f.id AS "farmId",
              (SELECT COUNT(*) FROM farm_units u
                WHERE u."farmId" = f.id AND u."deletedAt" IS NULL) AS "units",
              (SELECT COUNT(*) FROM plantings p
                WHERE p."farmId" = f.id AND p."deletedAt" IS NULL
                  AND p.status IN ('planned', 'active')) AS "plantings",
              (SELECT COALESCE(SUM(p."plantCount"), 0) FROM plantings p
                WHERE p."farmId" = f.id AND p."deletedAt" IS NULL
                  AND p.status = 'active') AS "plants",
              (SELECT COUNT(*) FROM farm_inspections i
                WHERE i."farmId" = f.id AND i."deletedAt" IS NULL
                  AND i.status <> 'resolved') AS "inspections"
         FROM farms f WHERE f.id = ANY($1::uuid[])`,
      [ids],
    );
    const stats = new Map(rows.map((r) => [r.farmId, r]));
    return farms.map((farm) => {
      const s = stats.get(farm.id);
      return Object.assign(farm, {
        unitCount: Number(s?.units ?? 0),
        activePlantings: Number(s?.plantings ?? 0),
        livePlants: Number(s?.plants ?? 0),
        openInspections: Number(s?.inspections ?? 0),
      });
    });
  }

  async findOne(id: string, tenantId: string): Promise<Farm> {
    const farm = await this.farms.findOne({
      where: { id, tenantId },
      relations: ['branch', 'warehouse'],
    });
    if (!farm) throw new NotFoundException('المزرعة غير موجودة');
    assertBranchVisible(farm.branchId, 'المزرعة غير موجودة');
    return farm;
  }

  /** المزرعة داخل معاملة (للخدمات الأخرى) مع قيد الفروع */
  async farmOf(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<Farm> {
    const farm = await manager.findOne(Farm, { where: { id, tenantId } });
    if (!farm) throw new NotFoundException('المزرعة غير موجودة');
    assertBranchVisible(farm.branchId, 'المزرعة غير موجودة');
    return farm;
  }

  async create(dto: CreateFarmDto, tenantId: string): Promise<Farm> {
    const id = await this.dataSource.transaction(async (manager) => {
      const code = dto.code?.trim()
        ? dto.code.trim()
        : await nextDocumentNumber(
            manager,
            'farms',
            CODE_PREFIX,
            tenantId,
            'code',
          );
      await this.assertUniqueFarm(manager, tenantId, code, dto.name.trim());
      const placement = await this.placement(manager, tenantId, dto);
      const boundary = normalizeRing(dto.boundary, 'حدود المزرعة');
      const saved = await manager.save(
        manager.create(Farm, {
          tenantId,
          code,
          name: dto.name.trim(),
          ...placement,
          ownership: dto.ownership,
          leaseEndsOn: dto.leaseEndsOn ?? null,
          address: dto.address?.trim() || null,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          boundary,
          areaM2: dto.areaM2 ?? (boundary ? ringAreaM2(boundary) : null),
          laborHourCost: dto.laborHourCost ?? null,
          notes: dto.notes ?? null,
          isActive: dto.isActive ?? true,
        }),
      );
      return saved.id;
    });
    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateFarmDto,
    tenantId: string,
  ): Promise<Farm> {
    await this.dataSource.transaction(async (manager) => {
      const farm = await this.farmOf(manager, id, tenantId);
      const code = dto.code?.trim() || farm.code;
      const name = dto.name?.trim() || farm.name;
      if (code !== farm.code || name !== farm.name) {
        await this.assertUniqueFarm(manager, tenantId, code, name, id);
      }
      const changes: Partial<Farm> = { code, name };
      if (dto.warehouseId !== undefined || dto.branchId !== undefined) {
        Object.assign(
          changes,
          await this.placement(manager, tenantId, {
            warehouseId:
              dto.warehouseId !== undefined
                ? dto.warehouseId
                : farm.warehouseId,
            branchId: dto.branchId !== undefined ? dto.branchId : farm.branchId,
          }),
        );
      }
      if (dto.boundary !== undefined) {
        changes.boundary = normalizeRing(dto.boundary, 'حدود المزرعة');
        if (dto.areaM2 === undefined && changes.boundary) {
          changes.areaM2 = ringAreaM2(changes.boundary);
        }
      }
      for (const key of [
        'ownership',
        'leaseEndsOn',
        'latitude',
        'longitude',
        'areaM2',
        'laborHourCost',
        'notes',
        'isActive',
      ] as const) {
        if (dto[key] !== undefined) {
          (changes as Record<string, unknown>)[key] = dto[key];
        }
      }
      if (dto.address !== undefined)
        changes.address = dto.address?.trim() || null;
      await manager.update(Farm, { id, tenantId }, changes);
    });
    return this.findOne(id, tenantId);
  }

  /** حذف مزرعة بلا زراعات ولا عمل مسجّل؛ غيرها يوقف (isActive) */
  async remove(id: string, tenantId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.farmOf(manager, id, tenantId);
      const [used] = await manager.query<{ used: boolean }[]>(
        `SELECT EXISTS (SELECT 1 FROM plantings WHERE "farmId" = $1)
             OR EXISTS (SELECT 1 FROM farm_operations WHERE "farmId" = $1)
             OR EXISTS (SELECT 1 FROM farm_harvests WHERE "farmId" = $1) AS "used"`,
        [id],
      );
      if (used?.used) {
        throw new ConflictException(
          'على المزرعة زراعات أو عمل مسجّل — أوقفها بدل حذفها',
        );
      }
      await manager.softDelete(FarmUnit, { farmId: id, tenantId });
      await manager.softDelete(FarmWaterSource, { farmId: id, tenantId });
      await manager.softDelete(Farm, { id, tenantId });
    });
  }

  // ══════════════════════════ شجرة الوحدات ══════════════════════════

  /** وحدات المزرعة مسطّحة بترتيب الشجرة (الأب ثم أبناؤه) */
  async listUnits(farmId: string, tenantId: string): Promise<FarmUnit[]> {
    await this.findOne(farmId, tenantId);
    const units = await this.units.find({
      where: { farmId, tenantId },
      relations: ['waterSource'],
      order: { depth: 'ASC', sortOrder: 'ASC', name: 'ASC' },
    });
    return treeOrder(units);
  }

  async createUnit(
    farmId: string,
    dto: CreateFarmUnitDto,
    tenantId: string,
  ): Promise<FarmUnit> {
    const id = await this.dataSource.transaction(async (manager) => {
      await this.farmOf(manager, farmId, tenantId);
      const parent = await this.parentOf(
        manager,
        farmId,
        dto.parentId,
        tenantId,
      );
      await this.assertWaterSource(
        manager,
        farmId,
        dto.waterSourceId,
        tenantId,
      );
      const unit = await this.insertUnit(manager, tenantId, farmId, parent, {
        ...dto,
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        sortOrder:
          dto.sortOrder ?? (await this.nextSort(manager, farmId, parent)),
      });
      return unit.id;
    });
    return this.unitOf(this.dataSource.manager, id, tenantId);
  }

  /** وحدات متتالية: "صف 1" … "صف 40" بأكواد R1 … R40 */
  async bulkUnits(
    farmId: string,
    dto: BulkFarmUnitsDto,
    tenantId: string,
  ): Promise<FarmUnit[]> {
    const ids = await this.dataSource.transaction(async (manager) => {
      await this.farmOf(manager, farmId, tenantId);
      const parent = await this.parentOf(
        manager,
        farmId,
        dto.parentId,
        tenantId,
      );
      const start = dto.startNumber ?? 1;
      let sortOrder = await this.nextSort(manager, farmId, parent);
      const created: string[] = [];
      for (let n = start; n < start + dto.count; n++) {
        const unit = await this.insertUnit(manager, tenantId, farmId, parent, {
          kind: dto.kind,
          name: `${dto.namePrefix.trim()} ${n}`,
          code: `${dto.codePrefix?.trim() ?? ''}${n}`,
          sortOrder: sortOrder++,
          plannedPositions: dto.plannedPositions,
          areaM2: dto.areaM2,
          soilType: dto.soilType,
          irrigationMethod: dto.irrigationMethod,
          irrigationIntervalDays: dto.irrigationIntervalDays,
        });
        created.push(unit.id);
      }
      return created;
    });
    const units = await this.units.find({
      where: ids.map((id) => ({ id, tenantId })),
      order: { sortOrder: 'ASC' },
    });
    return units;
  }

  async updateUnit(
    farmId: string,
    unitId: string,
    dto: UpdateFarmUnitDto,
    tenantId: string,
  ): Promise<FarmUnit> {
    await this.dataSource.transaction(async (manager) => {
      await this.farmOf(manager, farmId, tenantId);
      const unit = await this.unitOf(manager, unitId, tenantId);
      if (unit.farmId !== farmId)
        throw new NotFoundException('الوحدة غير موجودة');
      await this.assertWaterSource(
        manager,
        farmId,
        dto.waterSourceId,
        tenantId,
      );

      const changes: Partial<FarmUnit> = {};
      if (dto.name !== undefined) changes.name = dto.name.trim();
      if (dto.code !== undefined) changes.code = dto.code?.trim() || null;
      if (dto.boundary !== undefined) {
        changes.boundary = normalizeRing(dto.boundary, `حدود ${unit.name}`);
        if (dto.areaM2 === undefined && changes.boundary) {
          changes.areaM2 = ringAreaM2(changes.boundary);
        }
      }
      for (const key of [
        'kind',
        'sortOrder',
        'areaM2',
        'soilType',
        'irrigationMethod',
        'irrigationIntervalDays',
        'plannedPositions',
        'waterSourceId',
        'notes',
        'isActive',
      ] as const) {
        if (dto[key] !== undefined) {
          (changes as Record<string, unknown>)[key] = dto[key];
        }
      }
      if (changes.name && changes.name !== unit.name) {
        await this.assertUniqueUnit(
          manager,
          farmId,
          unit.parentId ?? null,
          changes.name,
          unitId,
        );
      }
      if (Object.keys(changes).length) {
        await manager.update(FarmUnit, { id: unitId }, changes);
      }
      // نقل الوحدة بما تحتها
      if (
        dto.parentId !== undefined &&
        (dto.parentId ?? null) !== (unit.parentId ?? null)
      ) {
        await this.moveUnit(manager, unit, dto.parentId ?? null, tenantId);
      }
    });
    return this.unitOf(this.dataSource.manager, unitId, tenantId);
  }

  /** حذف وحدة فارغة (بلا أبناء ولا زراعات ولا عمل)؛ المستعملة توقف */
  async removeUnit(
    farmId: string,
    unitId: string,
    tenantId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.farmOf(manager, farmId, tenantId);
      const unit = await this.unitOf(manager, unitId, tenantId);
      if (unit.farmId !== farmId)
        throw new NotFoundException('الوحدة غير موجودة');
      const [used] = await manager.query<
        { children: boolean; used: boolean }[]
      >(
        `SELECT EXISTS (SELECT 1 FROM farm_units WHERE "parentId" = $1 AND "deletedAt" IS NULL) AS "children",
                EXISTS (SELECT 1 FROM plantings WHERE "unitId" = $1)
             OR EXISTS (SELECT 1 FROM farm_plants WHERE "unitId" = $1)
             OR EXISTS (SELECT 1 FROM farm_operations WHERE "unitId" = $1)
             OR EXISTS (SELECT 1 FROM farm_harvests WHERE "unitId" = $1)
             OR EXISTS (SELECT 1 FROM farm_inspections WHERE "unitId" = $1) AS "used"`,
        [unitId],
      );
      if (used?.children) {
        throw new ConflictException('احذف الوحدات التي تحتها أولاً');
      }
      if (used?.used) {
        throw new ConflictException(
          'على الوحدة زراعات أو عمل مسجّل — أوقفها بدل حذفها',
        );
      }
      await manager.softDelete(FarmUnit, { id: unitId });
    });
  }

  /** وحدة بمعرّفها (للخدمات الأخرى) */
  async unitOf(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<FarmUnit> {
    const unit = await manager.findOne(FarmUnit, {
      where: { id, tenantId },
      relations: ['waterSource'],
    });
    if (!unit) throw new NotFoundException('الوحدة غير موجودة');
    return unit;
  }

  /** معرّفات الوحدة وكل ما تحتها */
  async subtreeIds(manager: EntityManager, unit: FarmUnit): Promise<string[]> {
    const rows = await manager.query<{ id: string }[]>(
      `SELECT id FROM farm_units
        WHERE "farmId" = $1 AND "deletedAt" IS NULL
          AND (id = $2 OR path LIKE $3)`,
      [unit.farmId, unit.id, `${unit.path}/%`],
    );
    return rows.map((r) => r.id);
  }

  // ══════════════════════════ مصادر المياه ══════════════════════════

  async listWaterSources(
    farmId: string,
    tenantId: string,
  ): Promise<FarmWaterSource[]> {
    await this.findOne(farmId, tenantId);
    return this.waterSources.find({
      where: { farmId, tenantId },
      order: { name: 'ASC' },
    });
  }

  async createWaterSource(
    farmId: string,
    dto: WaterSourceDto,
    tenantId: string,
  ): Promise<FarmWaterSource> {
    await this.findOne(farmId, tenantId);
    return this.waterSources.save(
      this.waterSources.create({
        ...dto,
        name: dto.name.trim(),
        tenantId,
        farmId,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  async updateWaterSource(
    farmId: string,
    sourceId: string,
    dto: UpdateWaterSourceDto,
    tenantId: string,
  ): Promise<FarmWaterSource> {
    await this.findOne(farmId, tenantId);
    const source = await this.waterSources.findOne({
      where: { id: sourceId, farmId, tenantId },
    });
    if (!source) throw new NotFoundException('مصدر المياه غير موجود');
    Object.assign(source, dto, dto.name ? { name: dto.name.trim() } : {});
    return this.waterSources.save(source);
  }

  async removeWaterSource(
    farmId: string,
    sourceId: string,
    tenantId: string,
  ): Promise<void> {
    await this.findOne(farmId, tenantId);
    const result = await this.waterSources.softDelete({
      id: sourceId,
      farmId,
      tenantId,
    });
    if (!result.affected) throw new NotFoundException('مصدر المياه غير موجود');
  }

  // ══════════════════════════ الطقس ══════════════════════════

  async listWeather(
    farmId: string,
    query: WeatherQueryDto,
    tenantId: string,
  ): Promise<FarmWeatherLog[]> {
    await this.findOne(farmId, tenantId);
    const qb = this.weather
      .createQueryBuilder('w')
      .where('w.tenantId = :tenantId AND w.farmId = :farmId', {
        tenantId,
        farmId,
      })
      .orderBy('w.date', 'DESC')
      .limit(400);
    if (query.from) qb.andWhere('w.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('w.date <= :to', { to: query.to });
    return qb.getMany();
  }

  /** طقس يوم: يُستبدل إن سُجّل لنفس اليوم */
  async upsertWeather(
    farmId: string,
    dto: WeatherLogDto,
    tenantId: string,
  ): Promise<FarmWeatherLog> {
    await this.findOne(farmId, tenantId);
    const existing = await this.weather.findOne({
      where: { farmId, tenantId, date: dto.date },
    });
    const log =
      existing ?? this.weather.create({ tenantId, farmId, date: dto.date });
    Object.assign(log, {
      tempMin: dto.tempMin ?? null,
      tempMax: dto.tempMax ?? null,
      rainMm: dto.rainMm ?? null,
      humidity: dto.humidity ?? null,
      windKmh: dto.windKmh ?? null,
      frost: dto.frost ?? false,
      dustStorm: dto.dustStorm ?? false,
      notes: dto.notes ?? null,
    });
    return this.weather.save(log);
  }

  async removeWeather(
    farmId: string,
    logId: string,
    tenantId: string,
  ): Promise<void> {
    await this.findOne(farmId, tenantId);
    const result = await this.weather.softDelete({
      id: logId,
      farmId,
      tenantId,
    });
    if (!result.affected) throw new NotFoundException('سجل الطقس غير موجود');
  }

  // ══════════════════════════ الخريطة ══════════════════════════

  /**
   * المزرعة على الخريطة: حدود كل وحدة وحالتها — محتاج ري (آخر ري على الوحدة
   * أو أحد آبائها مقابل موعدها)، إصابات مفتوحة وأشدها، فترة أمان مبيد سارية،
   * وزراعات قارب حصادها.
   */
  async map(
    farmId: string,
    tenantId: string,
  ): Promise<{ farm: Farm; units: FarmMapUnit[]; today: string }> {
    const farm = await this.findOne(farmId, tenantId);
    const zone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    const today = dayKeyInZone(new Date(), zone);
    const units = treeOrder(
      await this.units.find({
        where: { farmId, tenantId },
        order: { depth: 'ASC', sortOrder: 'ASC', name: 'ASC' },
      }),
    );
    const byId = new Map(units.map((u) => [u.id, u]));

    const [plantings, plants, inspections, operations] = await Promise.all([
      this.dataSource.query<
        {
          id: string;
          number: string;
          unitId: string;
          cropName: string;
          varietyName: string | null;
          plantCount: number;
          expectedHarvestAt: string | null;
        }[]
      >(
        `SELECT p.id, p.number, p."unitId", c.name AS "cropName", v.name AS "varietyName",
                p."plantCount", to_char(p."expectedHarvestAt", 'YYYY-MM-DD') AS "expectedHarvestAt"
           FROM plantings p
           JOIN crops c ON c.id = p."cropId"
           LEFT JOIN crop_varieties v ON v.id = p."varietyId"
          WHERE p."farmId" = $1 AND p."deletedAt" IS NULL AND p.status = 'active'`,
        [farmId],
      ),
      this.dataSource.query<
        { unitId: string; live: string; infested: string }[]
      >(
        `SELECT "unitId",
                COUNT(*) FILTER (WHERE status NOT IN ('dead', 'removed')) AS "live",
                COUNT(*) FILTER (WHERE status IN ('${PlantStatus.INFESTED}', '${PlantStatus.DISEASED}')) AS "infested"
           FROM farm_plants WHERE "farmId" = $1 AND "deletedAt" IS NULL
          GROUP BY "unitId"`,
        [farmId],
      ),
      this.dataSource.query<
        { unitId: string | null; open: string; severity: number }[]
      >(
        `SELECT COALESCE(i."unitId", pl."unitId") AS "unitId",
                COUNT(*) AS "open", MAX(i.severity) AS "severity"
           FROM farm_inspections i
           LEFT JOIN farm_plants pl ON pl.id = i."plantId"
          WHERE i."farmId" = $1 AND i."deletedAt" IS NULL AND i.status <> 'resolved'
          GROUP BY 1`,
        [farmId],
      ),
      this.dataSource.query<
        {
          unitId: string | null;
          type: FarmOperationType;
          lastAt: Date | null;
          allowedAt: string | null;
        }[]
      >(
        `SELECT "unitId", type, MAX("performedAt") AS "lastAt",
                to_char(MAX("harvestAllowedAt"), 'YYYY-MM-DD') AS "allowedAt"
           FROM farm_operations
          WHERE "farmId" = $1 AND "deletedAt" IS NULL AND status = '${FarmOperationStatus.DONE}'
            AND type IN ('${FarmOperationType.IRRIGATION}', '${FarmOperationType.SPRAYING}')
          GROUP BY "unitId", type`,
        [farmId],
      ),
    ]);

    // ما يقع على الوحدة أو أحد آبائها (أو المزرعة كلها) يسري عليها
    const lastIrrigation = new Map<string | null, Date>();
    const phi = new Map<string | null, string>();
    for (const op of operations) {
      if (op.type === FarmOperationType.IRRIGATION && op.lastAt) {
        lastIrrigation.set(op.unitId, new Date(op.lastAt));
      }
      if (op.type === FarmOperationType.SPRAYING && op.allowedAt) {
        phi.set(op.unitId, op.allowedAt);
      }
    }
    const lineage = (unit: FarmUnit): (string | null)[] => [
      null,
      ...unit.path.split('/'),
    ];

    const subtreeOf = (unit: FarmUnit) =>
      units.filter(
        (u) => u.id === unit.id || u.path.startsWith(`${unit.path}/`),
      );
    const plantStats = new Map(plants.map((p) => [p.unitId, p]));
    const inspectionStats = new Map(inspections.map((i) => [i.unitId, i]));

    const intervalOf = (unit: FarmUnit): number | null => {
      for (const id of [...unit.path.split('/')].reverse()) {
        const days = byId.get(id)?.irrigationIntervalDays;
        if (days) return days;
      }
      return null;
    };

    const mapUnits = units.map((unit): FarmMapUnit => {
      const ancestors = lineage(unit);
      const last = ancestors
        .map((id) => lastIrrigation.get(id))
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const allowed = ancestors
        .map((id) => phi.get(id))
        .filter((d): d is string => !!d && d > today)
        .sort()
        .pop();
      const subtree = subtreeOf(unit);
      let live = 0;
      let infested = 0;
      let open = 0;
      let severity = 0;
      for (const u of subtree) {
        const p = plantStats.get(u.id);
        live += Number(p?.live ?? 0);
        infested += Number(p?.infested ?? 0);
        const i = inspectionStats.get(u.id);
        open += Number(i?.open ?? 0);
        severity = Math.max(severity, Number(i?.severity ?? 0));
      }
      const own = plantings.filter((p) => p.unitId === unit.id);
      const interval = intervalOf(unit);
      const lastDay = last ? dayKeyInZone(last, zone) : null;
      return {
        id: unit.id,
        parentId: unit.parentId ?? null,
        kind: unit.kind,
        name: unit.name,
        code: unit.code ?? null,
        depth: unit.depth,
        boundary: unit.boundary ?? null,
        areaM2: unit.areaM2 ?? null,
        plantings: own.map((p) => ({
          id: p.id,
          number: p.number,
          cropName: p.cropName,
          varietyName: p.varietyName,
          plantCount: Number(p.plantCount),
          expectedHarvestAt: p.expectedHarvestAt,
        })),
        livePlants: live,
        infestedPlants: infested,
        openInspections: open,
        maxSeverity: severity,
        lastIrrigationAt: last?.toISOString() ?? null,
        irrigationIntervalDays: interval,
        irrigationDue:
          !!interval && (!lastDay || daysBetween(lastDay, today) >= interval),
        harvestAllowedAt: allowed ?? null,
        harvestReady: plantings.some(
          (p) =>
            subtree.some((u) => u.id === p.unitId) &&
            !!p.expectedHarvestAt &&
            daysBetween(today, p.expectedHarvestAt) <= 7,
        ),
      };
    });
    return { farm, units: mapUnits, today };
  }

  // ══════════════════════════ مساعدات ══════════════════════════

  /** مخزن المزرعة وفرعها (الفرع من المخزن إن لم يُحدَّد) */
  private async placement(
    manager: EntityManager,
    tenantId: string,
    dto: { warehouseId?: string | null; branchId?: string | null },
  ): Promise<{ warehouseId: string | null; branchId: string | null }> {
    let branchId = dto.branchId ?? null;
    if (dto.warehouseId) {
      const [warehouse] = await this.warehouses.findActiveByIds(
        [dto.warehouseId],
        tenantId,
        manager,
      );
      branchId = branchId ?? warehouse.branchId ?? null;
      if (
        dto.branchId &&
        warehouse.branchId &&
        dto.branchId !== warehouse.branchId
      ) {
        throw new BadRequestException('مخزن المزرعة يتبع فرعاً آخر');
      }
    }
    if (branchId) {
      const [branch] = await manager.query<{ id: string }[]>(
        `SELECT id FROM branches WHERE id = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL`,
        [branchId, tenantId],
      );
      if (!branch) throw new NotFoundException('الفرع غير موجود');
      assertBranchAllowed(branchId);
    }
    return { warehouseId: dto.warehouseId ?? null, branchId };
  }

  private async assertUniqueFarm(
    manager: EntityManager,
    tenantId: string,
    code: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const rows = await manager.query<{ code: string; name: string }[]>(
      `SELECT code, name FROM farms
        WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND (code = $2 OR name = $3)
          AND ($4::uuid IS NULL OR id <> $4)`,
      [tenantId, code, name, exceptId ?? null],
    );
    if (rows.some((r) => r.code === code)) {
      throw new ConflictException(`كود المزرعة ${code} مستعمل`);
    }
    if (rows.length) throw new ConflictException(`مزرعة باسم "${name}" موجودة`);
  }

  private async assertUniqueUnit(
    manager: EntityManager,
    farmId: string,
    parentId: string | null,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await manager.findOne(FarmUnit, {
      where: { farmId, parentId: parentId ?? IsNull(), name },
    });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException(`وحدة باسم "${name}" موجودة في نفس المكان`);
    }
  }

  private async parentOf(
    manager: EntityManager,
    farmId: string,
    parentId: string | null | undefined,
    tenantId: string,
  ): Promise<FarmUnit | null> {
    if (!parentId) return null;
    const parent = await this.unitOf(manager, parentId, tenantId);
    if (parent.farmId !== farmId) {
      throw new BadRequestException('الوحدة الأب في مزرعة أخرى');
    }
    if (parent.depth >= MAX_UNIT_DEPTH) {
      throw new BadRequestException(
        `أقصى عمق للتقسيم ${MAX_UNIT_DEPTH} مستويات`,
      );
    }
    return parent;
  }

  private async assertWaterSource(
    manager: EntityManager,
    farmId: string,
    sourceId: string | null | undefined,
    tenantId: string,
  ): Promise<void> {
    if (!sourceId) return;
    const source = await manager.findOne(FarmWaterSource, {
      where: { id: sourceId, farmId, tenantId },
    });
    if (!source)
      throw new NotFoundException('مصدر المياه غير موجود في هذه المزرعة');
  }

  private async nextSort(
    manager: EntityManager,
    farmId: string,
    parent: FarmUnit | null,
  ): Promise<number> {
    const [row] = await manager.query<{ next: number }[]>(
      `SELECT COALESCE(MAX("sortOrder") + 1, 0) AS "next" FROM farm_units
        WHERE "farmId" = $1 AND "deletedAt" IS NULL
          AND "parentId" IS NOT DISTINCT FROM $2`,
      [farmId, parent?.id ?? null],
    );
    return Number(row?.next ?? 0);
  }

  private async insertUnit(
    manager: EntityManager,
    tenantId: string,
    farmId: string,
    parent: FarmUnit | null,
    data: Omit<CreateFarmUnitDto, 'parentId'> & { sortOrder: number },
  ): Promise<FarmUnit> {
    await this.assertUniqueUnit(manager, farmId, parent?.id ?? null, data.name);
    const boundary = normalizeRing(data.boundary, `حدود ${data.name}`);
    const unit = manager.create(FarmUnit, {
      tenantId,
      farmId,
      parentId: parent?.id ?? null,
      kind: data.kind,
      name: data.name,
      code: data.code ?? null,
      depth: (parent?.depth ?? 0) + 1,
      path: '',
      sortOrder: data.sortOrder,
      boundary,
      areaM2: data.areaM2 ?? (boundary ? ringAreaM2(boundary) : null),
      soilType: data.soilType ?? null,
      irrigationMethod: data.irrigationMethod ?? null,
      irrigationIntervalDays: data.irrigationIntervalDays ?? null,
      plannedPositions: data.plannedPositions ?? null,
      waterSourceId: data.waterSourceId ?? null,
      notes: data.notes ?? null,
      isActive: data.isActive ?? true,
    });
    const saved = await manager.save(unit);
    saved.path = parent ? `${parent.path}/${saved.id}` : saved.id;
    await manager.update(FarmUnit, { id: saved.id }, { path: saved.path });
    return saved;
  }

  /** نقل وحدة وما تحتها لأب آخر: المسار والعمق لكل الشجرة الفرعية */
  private async moveUnit(
    manager: EntityManager,
    unit: FarmUnit,
    parentId: string | null,
    tenantId: string,
  ): Promise<void> {
    const parent = await this.parentOf(
      manager,
      unit.farmId,
      parentId,
      tenantId,
    );
    if (
      parent &&
      (parent.id === unit.id || parent.path.startsWith(`${unit.path}/`))
    ) {
      throw new BadRequestException(
        'لا تُنقل الوحدة تحت نفسها أو تحت ما تحتها',
      );
    }
    const [deepest] = await manager.query<{ depth: number }[]>(
      `SELECT COALESCE(MAX(depth), 0) AS "depth" FROM farm_units
        WHERE "farmId" = $1 AND "deletedAt" IS NULL AND (id = $2 OR path LIKE $3)`,
      [unit.farmId, unit.id, `${unit.path}/%`],
    );
    const shift = (parent?.depth ?? 0) + 1 - unit.depth;
    if (Number(deepest?.depth ?? unit.depth) + shift > MAX_UNIT_DEPTH) {
      throw new BadRequestException(
        `أقصى عمق للتقسيم ${MAX_UNIT_DEPTH} مستويات`,
      );
    }
    await this.assertUniqueUnit(
      manager,
      unit.farmId,
      parent?.id ?? null,
      unit.name,
      unit.id,
    );
    const newPath = parent ? `${parent.path}/${unit.id}` : unit.id;
    await manager.query(
      `UPDATE farm_units
          SET path = $1 || substr(path, length($2) + 1), depth = depth + $3,
              "updatedAt" = now()
        WHERE "farmId" = $4 AND (id = $5 OR path LIKE $6)`,
      [newPath, unit.path, shift, unit.farmId, unit.id, `${unit.path}/%`],
    );
    await manager.update(
      FarmUnit,
      { id: unit.id },
      { parentId: parent?.id ?? null },
    );
  }
}

/** ترتيب الشجرة: كل أب يتبعه أبناؤه بترتيبهم */
export function treeOrder<
  T extends {
    id: string;
    parentId?: string | null;
    sortOrder: number;
    name: string;
  },
>(units: T[]): T[] {
  const children = new Map<string | null, T[]>();
  for (const unit of units) {
    const key = unit.parentId ?? null;
    children.set(key, [...(children.get(key) ?? []), unit]);
  }
  for (const list of children.values()) {
    list.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ar'),
    );
  }
  const ordered: T[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const unit of children.get(parentId) ?? []) {
      if (seen.has(unit.id)) continue;
      seen.add(unit.id);
      ordered.push(unit);
      walk(unit.id);
    }
  };
  walk(null);
  // أيتام (أبوهم محذوف): في الآخر حتى لا يختفوا
  for (const unit of units) if (!seen.has(unit.id)) ordered.push(unit);
  return ordered;
}
