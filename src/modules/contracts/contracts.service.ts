// src/modules/contracts/contracts.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, In } from 'typeorm';
import { scopedEmployeeWhere } from '../branches/branch-scope';
import { Contract, ContractType } from './entities/contract.entity';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import {
  calculateContractEndDate,
  calculateProbationEndDate,
} from './utils/contract-dates.util';
import { DomainEvents } from '../../common/events/domain-events';
import { FilesService } from '../files/files.service';

/** العقد كما تعرضه الصفحات: الموظف ومرفقاته (تصل بروابط موقَّعة) */
const CONTRACT_RELATIONS = ['employee', 'attachments'];

/** YYYY-MM-DD من عمود date (نص) أو Date */
const dayOf = (value?: Date | string | null): string | null =>
  value ? new Date(value).toISOString().slice(0, 10) : null;

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private readonly repo: Repository<Contract>,
    private readonly events: DomainEvents,
    private readonly files: FilesService,
  ) {}

  async create(dto: CreateContractDto, tenantId: string): Promise<Contract> {
    const { attachmentFileIds = [], ...fields } = dto;
    // التحقق من وجود عقد مسبق للموظف
    const existing = await this.repo.findOne({
      where: { employeeId: dto.employeeId, tenantId },
    });

    if (existing) {
      throw new BadRequestException('هذا الموظف لديه عقد مسجل بالفعل');
    }

    const contractStart = new Date(dto.startDate);
    // ✅ 1. حساب تاريخ نهاية فترة التجربة
    const probationEndDate = calculateProbationEndDate(
      contractStart,
      dto.probationPeriod,
    );
    // ✅ 2. حساب تاريخ نهاية العقد (إذا لم يُدخل يدوياً وكانت هناك مدة بالشهور)
    const calculatedEndDate = calculateContractEndDate(
      contractStart,
      dto.endDate,
      dto.contractDurationMonths,
    );

    const contract = this.repo.create({
      ...fields,
      attachments: await this.files.resolve(attachmentFileIds, tenantId),
      tenantId,
      endDate: calculatedEndDate, // استخدام التاريخ المحسوب
      probationEndDate: probationEndDate, // حفظ تاريخ نهاية التجربة
    });

    return await this.repo.save(contract);
  }

  async findAll(tenantId: string): Promise<Contract[]> {
    return await this.repo.find({
      where: { tenantId, ...scopedEmployeeWhere() },
      relations: CONTRACT_RELATIONS,
    });
  }

  async getByEmployeeId(
    employeeId: string,
    tenantId: string,
  ): Promise<Contract | null> {
    return await this.repo.findOne({
      where: { employeeId, tenantId },
    });
  }

  async search(tenantId: string, query: string) {
    // contractType عمود enum — LIKE لا يعمل عليه في Postgres، فنطابق قيمه هنا
    const matchingTypes = Object.values(ContractType).filter((type) =>
      String(type).includes(query),
    );

    return await this.repo.find({
      where: [
        {
          tenantId,
          employee: {
            fullName: ILike(`%${query}%`),
          },
        },
        ...(matchingTypes.length
          ? [{ tenantId, contractType: In(matchingTypes) }]
          : []),
      ],
      relations: CONTRACT_RELATIONS,
    });
  }

  async findOne(id: string, tenantId: string): Promise<Contract> {
    const contract = await this.repo.findOne({
      where: { id, tenantId },
      relations: [...CONTRACT_RELATIONS, 'employee.department'],
    });
    if (!contract) throw new NotFoundException('العقد غير موجود');
    return contract;
  }

  async update(
    id: string,
    dto: UpdateContractDto,
    tenantId: string,
  ): Promise<Contract> {
    const contract = await this.findOne(id, tenantId);
    const previousEnd = dayOf(contract.endDate);
    const { attachmentFileIds, ...fields } = dto;

    // ✅ إعادة حساب التواريخ عند التحديث إذا تغيرت المدخلات ذات الصلة
    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : contract.startDate;

    Object.assign(contract, fields);
    if (attachmentFileIds !== undefined) {
      contract.attachments = await this.files.resolve(
        attachmentFileIds,
        tenantId,
      );
    }

    if (dto.probationPeriod !== undefined) {
      // null (وليس undefined) حتى يُمسح التاريخ فعلياً من قاعدة البيانات
      contract.probationEndDate =
        calculateProbationEndDate(startDate, dto.probationPeriod) ?? null;
    }

    const endDate = calculateContractEndDate(
      startDate,
      dto.endDate,
      dto.contractDurationMonths,
    );
    if (endDate) contract.endDate = endDate;
    const saved = await this.repo.save(contract);

    // امتد تاريخ الانتهاء = تجديد (يُبلَّغ الموظف، وتبدأ تنبيهات التاريخ الجديد)
    const newEnd = dayOf(saved.endDate);
    if (newEnd && previousEnd && newEnd > previousEnd) {
      this.events.emit('contract.renewed', {
        tenantId,
        contractId: saved.id,
        employeeId: saved.employeeId,
        previousEndDate: previousEnd,
        endDate: newEnd,
      });
    }
    return saved;
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const contract = await this.findOne(id, tenantId);
    await this.repo.remove(contract);
  }
}
