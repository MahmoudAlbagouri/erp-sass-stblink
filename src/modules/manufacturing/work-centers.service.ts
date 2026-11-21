// src/modules/manufacturing/work-centers.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import {
  CreateWorkCenterDto,
  UpdateWorkCenterDto,
} from './dto/manufacturing.dto';
import { WorkCenter } from './entities/work-center.entity';

const CODE_PREFIX = 'WC-';

@Injectable()
export class WorkCentersService {
  constructor(
    @InjectRepository(WorkCenter)
    private readonly centers: Repository<WorkCenter>,
    private readonly dataSource: DataSource,
  ) {}

  findAll(tenantId: string, includeInactive = true): Promise<WorkCenter[]> {
    return this.centers.find({
      where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
      relations: ['branch'],
      order: { code: 'ASC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<WorkCenter> {
    const center = await this.centers.findOne({
      where: { id, tenantId },
      relations: ['branch'],
    });
    if (!center) throw new NotFoundException('مركز العمل غير موجود');
    return center;
  }

  /** مراكز فعّالة بمعرّفاتها (للقوائم والأوامر) */
  async findActiveByIds(
    ids: string[],
    tenantId: string,
  ): Promise<WorkCenter[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const found = await this.centers
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.id IN (:...ids)', { ids: unique })
      .getMany();
    if (found.length !== unique.length) {
      throw new NotFoundException('مركز العمل غير موجود');
    }
    const inactive = found.find((c) => !c.isActive);
    if (inactive) {
      throw new BadRequestException(`مركز العمل "${inactive.name}" موقوف`);
    }
    return found;
  }

  async create(
    dto: CreateWorkCenterDto,
    tenantId: string,
  ): Promise<WorkCenter> {
    const id = await this.dataSource.transaction(async (manager) => {
      const code = dto.code?.trim()
        ? dto.code.trim()
        : await nextDocumentNumber(
            manager,
            'work_centers',
            CODE_PREFIX,
            tenantId,
            'code',
          );
      await this.assertUnique(tenantId, code, dto.name);
      const center = await manager.save(
        manager.create(WorkCenter, {
          ...dto,
          code,
          name: dto.name.trim(),
          branchId: dto.branchId ?? null,
          tenantId,
        }),
      );
      return center.id;
    });
    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateWorkCenterDto,
    tenantId: string,
  ): Promise<WorkCenter> {
    await this.findOne(id, tenantId);
    await this.assertUnique(
      tenantId,
      dto.code?.trim() || undefined,
      dto.name?.trim() || undefined,
      id,
    );
    await this.centers.update(
      { id, tenantId },
      {
        ...dto,
        ...(dto.code ? { code: dto.code.trim() } : {}),
        ...(dto.name ? { name: dto.name.trim() } : {}),
      },
    );
    return this.findOne(id, tenantId);
  }

  /** حذف مركز لم يُستعمل؛ المستعمل يوقَف ويبقى لتاريخه */
  async remove(id: string, tenantId: string): Promise<void> {
    await this.findOne(id, tenantId);
    const [used] = await this.dataSource.query<{ used: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM bom_operations WHERE "workCenterId" = $1)
           OR EXISTS (SELECT 1 FROM production_order_operations WHERE "workCenterId" = $1)
           AS "used"`,
      [id],
    );
    if (used?.used) {
      throw new BadRequestException(
        'مركز العمل مستعمل في قوائم مكوّنات أو أوامر إنتاج — أوقفه بدل حذفه',
      );
    }
    await this.centers.softDelete({ id, tenantId });
  }

  private async assertUnique(
    tenantId: string,
    code?: string,
    name?: string,
    exceptId?: string,
  ): Promise<void> {
    if (!code && !name) return;
    const qb = this.centers
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('(c.code = :code OR c.name = :name)', {
        code: code ?? '\u0000',
        name: name ?? '\u0000',
      });
    if (exceptId) qb.andWhere('c.id <> :exceptId', { exceptId });
    const taken = await qb.getOne();
    if (taken) {
      throw new ConflictException(
        taken.code === code
          ? `الكود "${code}" مستخدم لمركز آخر`
          : `الاسم "${name}" مستخدم لمركز آخر`,
      );
    }
  }
}
