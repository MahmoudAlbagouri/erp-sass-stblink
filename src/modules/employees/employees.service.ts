// src/modules/employees/employees.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from './entities/employee.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { User } from '../users/entities/user.entity';

@Injectable()
export class EmployeesService {
  // عدد خانات بادئة الشركة وعدد خانات الرقم التسلسلي
  // لو جهاز البصمة عندك بيقبل أرقام أطول/أقصر من 7 خانات، غيّر القيمتين دول بس
  private readonly TENANT_PREFIX_DIGITS = 3; // 000 - 999
  private readonly SEQUENCE_DIGITS = 4; // 0000 - 9999

  constructor(
    @InjectRepository(Employee) private repo: Repository<Employee>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  /**
   * التحقق من عدم تكرار رقم الهوية داخل نفس الشركة
   */
  private async checkNationalIdUniqueness(
    nationalId: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    if (!nationalId) return;

    const existing = await this.repo.findOne({
      where: { nationalId, tenantId },
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `رقم الهوية "${nationalId}" مستخدم بالفعل من قبل الموظف: ${existing.fullName}`,
      );
    }
  }

  /**
   * ✅ بادئة رقمية بالكامل (من 000 لـ 999) مشتقة بشكل ثابت من tenantId
   * باستخدام دالة hash بسيطة وحتمية: نفس الـ tenantId هيدّي دايماً نفس
   * البادئة. مفيش حروف ولا فواصل، عشان جهاز البصمة (ZKTeco) بيقبل أرقام بس.
   *
   * احتمالية تطابق بادئتين لشركتين مختلفتين واردة رياضياً (1 من 1000)،
   * لكنها مش مشكلة عملياً لأن آلية إعادة المحاولة في create() بتكتشف أي
   * تعارض فعلي على مستوى الكود الكامل وتولّد رقم تسلسلي مختلف تلقائياً.
   */
  private getTenantPrefix(tenantId: string): string {
    const mod = 10 ** this.TENANT_PREFIX_DIGITS;
    let hash = 0;
    for (let i = 0; i < tenantId.length; i++) {
      hash = (hash * 31 + tenantId.charCodeAt(i)) % mod;
    }
    return hash.toString().padStart(this.TENANT_PREFIX_DIGITS, '0');
  }

  /**
   * توليد كود الموظف التالي: كود رقمي بالكامل = بادئة الشركة + رقم تسلسلي
   * مثال: "2350001" (بادئة 235 + رقم 0001)
   *
   * الترقيم لسه مستقل لكل شركة (بيبدأ من 0001 لكل tenant)، والبحث عن
   * أعلى رقم بيشمل الموظفين المحذوفين (withDeleted) عشان منولّدش كود
   * مُستخدم بالفعل سواء فعّال أو محذوف soft-delete.
   */
  private async generateEmployeeCode(tenantId: string): Promise<string> {
    const prefix = this.getTenantPrefix(tenantId);
    const totalLength = this.TENANT_PREFIX_DIGITS + this.SEQUENCE_DIGITS;

    const employees = await this.repo.find({
      where: { tenantId },
      select: ['employeeCode'],
      withDeleted: true,
    });

    let maxNumber = 0;
    for (const emp of employees) {
      const code = emp.employeeCode;
      if (!code) continue;

      // نهتم بس بالأكواد اللي بنفس بادئة الشركة الحالية وبنفس الطول المتوقع
      // (أي أكواد قديمة بصيغة مختلفة بنتجاهلها هنا ومش بنستخدمها في الحساب)
      if (code.length === totalLength && code.startsWith(prefix)) {
        const num = parseInt(code.slice(this.TENANT_PREFIX_DIGITS), 10);
        if (!isNaN(num) && num > maxNumber) maxNumber = num;
      }
    }

    const nextNumber = (maxNumber + 1)
      .toString()
      .padStart(this.SEQUENCE_DIGITS, '0');

    return `${prefix}${nextNumber}`;
  }

  async create(dto: CreateEmployeeDto, tenantId: string): Promise<Employee> {
    // 1. التحقق من تكرار رقم الهوية أولاً
    await this.checkNationalIdUniqueness(dto.nationalId!, tenantId);

    // التحقق من المستخدم المرتبط إذا تم إرساله
    let user: User | null = null;
    if (dto.userId) {
      user = await this.userRepo.findOneBy({ id: dto.userId, tenantId });
      if (!user)
        throw new NotFoundException('المستخدم غير موجود أو لا ينتمي لشركتك');
    }

    // 2. آلية إعادة المحاولة: حماية إضافية ضد أي تزامن نادر بين طلبين
    // بيوصلوا في نفس اللحظة، أو تطابق نادر في البادئة بين شركتين مختلفتين
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const employeeCode = await this.generateEmployeeCode(tenantId);

      const employee = this.repo.create({
        ...dto,
        employeeCode,
        user: user ?? undefined,
        tenantId,
        iqamaExpiryDate: dto.iqamaExpiryDate
          ? new Date(dto.iqamaExpiryDate)
          : undefined,
      });

      try {
        return await this.repo.save(employee);
      } catch (error: unknown) {
        const pgError = error as { code?: string; detail?: string };
        const isEmployeeCodeConflict =
          pgError.code === '23505' &&
          (pgError.detail?.includes('employeeCode') ||
            pgError.detail?.includes('employee_code'));

        if (!isEmployeeCodeConflict) throw error; // أي خطأ آخر يُرمى فوراً كما هو
        lastError = error;
        // وإلا أعد المحاولة بكود جديد
      }
    }

    throw lastError;
  }

  async findAll(tenantId: string): Promise<Employee[]> {
    return this.repo.find({
      where: { tenantId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Employee> {
    const employee = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['user', 'contract'],
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');
    return employee;
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    tenantId: string,
  ): Promise<Employee> {
    const employee = await this.findOne(id, tenantId);

    // التحقق من تكرار رقم الهوية عند التحديث
    if (dto.nationalId && dto.nationalId !== employee.nationalId) {
      await this.checkNationalIdUniqueness(dto.nationalId, tenantId, id);
    }

    if (dto.userId && dto.userId !== employee.user?.id) {
      const user = await this.userRepo.findOneBy({ id: dto.userId, tenantId });
      if (!user) throw new NotFoundException('المستخدم المحدد غير موجود');
      employee.user = user;
    }

    Object.assign(employee, dto);

    if (dto.iqamaExpiryDate) {
      employee.iqamaExpiryDate = new Date(dto.iqamaExpiryDate);
    } else if (
      dto.iqamaExpiryDate === null ||
      dto.iqamaExpiryDate === undefined
    ) {
      employee.iqamaExpiryDate = undefined;
    }

    return await this.repo.save(employee);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const employee = await this.findOne(id, tenantId);
    await this.repo.softRemove(employee);
  }
}
