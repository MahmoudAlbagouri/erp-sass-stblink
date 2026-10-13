// src/modules/branches/branches.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { assertBranchVisible, scopedBranchIds } from './branch-scope';
import { ensureMainBranch } from './branches.util';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { Branch } from './entities/branch.entity';

const NOT_FOUND = 'الفرع غير موجود';

export interface BranchWithCounts extends Branch {
  warehousesCount: number;
  employeesCount: number;
  devicesCount: number;
  usersCount: number;
}

interface CountRow {
  branchId: string;
  count: string;
}

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
  ) {}

  /** فروع الشركة (المسموحة للمستخدم)، الرئيسي أولاً */
  async findAll(tenantId: string): Promise<Branch[]> {
    await ensureMainBranch(this.branches.manager, tenantId);
    const allowed = scopedBranchIds();
    return this.branches.find({
      where: { tenantId, ...(allowed ? { id: In(allowed) } : {}) },
      order: { isMain: 'DESC', createdAt: 'ASC' },
    });
  }

  /** الفروع مع عدد ما يتبع كلاً منها: لصفحة إدارة الفروع */
  async findAllWithCounts(tenantId: string): Promise<BranchWithCounts[]> {
    const branches = await this.findAll(tenantId);
    const [warehouses, employees, devices, users] = await Promise.all([
      this.countBy(
        `SELECT "branchId", COUNT(*) AS count FROM warehouses
          WHERE "tenantId" = $1 AND "deletedAt" IS NULL GROUP BY "branchId"`,
        tenantId,
      ),
      this.countBy(
        `SELECT branch_id AS "branchId", COUNT(*) AS count FROM employees
          WHERE tenant_id = $1 AND "deletedAt" IS NULL AND status = 'active'
          GROUP BY branch_id`,
        tenantId,
      ),
      this.countBy(
        `SELECT branch_id AS "branchId", COUNT(*) AS count
           FROM biometric_devices WHERE tenant_id = $1 GROUP BY branch_id`,
        tenantId,
      ),
      this.countBy(
        `SELECT ub.branch_id AS "branchId", COUNT(*) AS count
           FROM user_branches ub
           JOIN users u ON u.id = ub.user_id AND u.deleted_at IS NULL
          WHERE u.tenant_id = $1 GROUP BY ub.branch_id`,
        tenantId,
      ),
    ]);

    return branches.map((branch) => ({
      ...branch,
      warehousesCount: warehouses.get(branch.id) ?? 0,
      employeesCount: employees.get(branch.id) ?? 0,
      devicesCount: devices.get(branch.id) ?? 0,
      usersCount: users.get(branch.id) ?? 0,
    }));
  }

  async findOne(id: string, tenantId: string): Promise<Branch> {
    const branch = await this.branches.findOne({ where: { id, tenantId } });
    if (!branch) throw new NotFoundException(NOT_FOUND);
    assertBranchVisible(branch.id, NOT_FOUND);
    return branch;
  }

  async create(dto: CreateBranchDto, tenantId: string): Promise<Branch> {
    await ensureMainBranch(this.branches.manager, tenantId);
    await this.assertNameFree(dto.name, tenantId);
    return this.branches.save(
      this.branches.create({ ...dto, tenantId, isMain: false }),
    );
  }

  async update(
    id: string,
    dto: UpdateBranchDto,
    tenantId: string,
  ): Promise<Branch> {
    const branch = await this.findOne(id, tenantId);

    if (dto.name && dto.name !== branch.name) {
      await this.assertNameFree(dto.name, tenantId, id);
    }
    if (dto.isActive === false && branch.isActive) {
      if (branch.isMain) {
        throw new BadRequestException('لا يمكن إيقاف الفرع الرئيسي');
      }
      await this.assertNoActiveWarehouses(branch, 'إيقاف');
    }

    Object.assign(branch, dto);
    return this.branches.save(branch);
  }

  /**
   * حذف منطقي. يُرفض ما دام للفرع مخازن أو مستخدمون مقيَّدون به: حذفه كان
   * سيترك مخازن بلا فرع، أو يحوّل مستخدماً مقيَّداً به وحده إلى مستخدم يرى كل
   * الفروع. موظفوه وأجهزة بصمته ينتقلون إلى الفرع الرئيسي.
   */
  async remove(id: string, tenantId: string): Promise<void> {
    const branch = await this.findOne(id, tenantId);
    if (branch.isMain) {
      throw new BadRequestException('لا يمكن حذف الفرع الرئيسي');
    }

    await this.branches.manager.transaction(async (manager) => {
      const [{ count: warehouses }] = await manager.query<CountRow[]>(
        `SELECT COUNT(*) AS count FROM warehouses
          WHERE "branchId" = $1 AND "deletedAt" IS NULL`,
        [id],
      );
      if (Number(warehouses) > 0) {
        throw new ConflictException(
          'للفرع مخازن تابعة له. انقلها إلى فرع آخر أو احذفها أولاً',
        );
      }

      const [{ count: users }] = await manager.query<CountRow[]>(
        `SELECT COUNT(*) AS count FROM user_branches ub
           JOIN users u ON u.id = ub.user_id AND u.deleted_at IS NULL
          WHERE ub.branch_id = $1`,
        [id],
      );
      if (Number(users) > 0) {
        throw new ConflictException(
          'يوجد مستخدمون مقيَّدون بهذا الفرع. عدّل فروعهم أولاً',
        );
      }

      const main = await ensureMainBranch(manager, tenantId);
      await manager.query(
        `UPDATE employees SET branch_id = $1 WHERE branch_id = $2`,
        [main.id, id],
      );
      await manager.query(
        `UPDATE biometric_devices SET branch_id = $1 WHERE branch_id = $2`,
        [main.id, id],
      );
      await manager.softRemove(branch);
    });
  }

  private async countBy(
    sql: string,
    tenantId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.branches.manager.query<CountRow[]>(sql, [tenantId]);
    return new Map(rows.map((row) => [row.branchId, Number(row.count)]));
  }

  private async assertNameFree(
    name: string,
    tenantId: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await this.branches.exists({
      where: { tenantId, name, ...(exceptId ? { id: Not(exceptId) } : {}) },
    });
    if (taken) throw new ConflictException('يوجد فرع بهذا الاسم');
  }

  private async assertNoActiveWarehouses(
    branch: Branch,
    action: string,
  ): Promise<void> {
    const [{ count }] = await this.branches.manager.query<CountRow[]>(
      `SELECT COUNT(*) AS count FROM warehouses
        WHERE "branchId" = $1 AND "deletedAt" IS NULL AND "isActive" = true`,
      [branch.id],
    );
    if (Number(count) > 0) {
      throw new ConflictException(
        `لا يمكن ${action} فرع له مخازن نشطة. أوقف مخازنه أو انقلها أولاً`,
      );
    }
  }
}
