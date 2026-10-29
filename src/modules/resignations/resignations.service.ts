import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { scopedEmployeeWhere } from '../branches/branch-scope';
import {
  ResignationRequest,
  ResignationStatus,
} from './entities/resignation.entity';
import { CreateResignationDto } from './dto/create-resignation.dto';
import { DecisionResignationDto } from './dto/decision-resignation.dto';
import { Employee } from '../employees/entities/employee.entity';
import { DomainEvents } from '../../common/events/domain-events';

@Injectable()
export class ResignationsService {
  constructor(
    @InjectRepository(ResignationRequest)
    private reqRepo: Repository<ResignationRequest>,
    @InjectRepository(Employee) private empRepo: Repository<Employee>,
    private readonly events: DomainEvents,
  ) {}

  // ✅ دالة جديدة لجلب طلبات الموظف الحالي
  async findMyRequests(
    employeeId: string,
    tenantId: string,
  ): Promise<ResignationRequest[]> {
    return this.reqRepo.find({
      where: { employeeId, tenantId },
      relations: ['employee'],
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    dto: CreateResignationDto,
    employeeId: string,
    tenantId: string,
    actorUserId?: string,
  ): Promise<ResignationRequest> {
    const employee = await this.empRepo.findOne({
      where: { id: employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');

    const pendingReq = await this.reqRepo.findOne({
      where: { employeeId, tenantId, status: ResignationStatus.PENDING },
    });
    if (pendingReq)
      throw new BadRequestException(
        'لديك بالفعل طلب استقالة معلق بانتظار الموافقة',
      );

    const lastDay = new Date(dto.lastWorkingDay);
    if (lastDay < new Date())
      throw new BadRequestException('لا يمكن تحديد آخر يوم عمل في الماضي');

    const request = this.reqRepo.create({
      ...dto,
      employeeId,
      requestDate: new Date(),
      lastWorkingDay: lastDay,
      tenantId,
      status: ResignationStatus.PENDING,
    });

    const saved = await this.reqRepo.save(request);
    this.events.emit('resignation.submitted', {
      tenantId,
      actorUserId,
      requestId: saved.id,
      employeeId,
      lastWorkingDay: dto.lastWorkingDay,
      reason: dto.reason,
    });
    return saved;
  }

  async makeDecision(
    id: string,
    dto: DecisionResignationDto,
    tenantId: string,
    actorUserId?: string,
  ): Promise<ResignationRequest> {
    const request = await this.reqRepo.findOne({ where: { id, tenantId } });
    if (!request) throw new NotFoundException('طلب الاستقالة غير موجود');

    if (request.status !== ResignationStatus.PENDING) {
      throw new BadRequestException(
        `لا يمكن اتخاذ قرار على طلب حالته الحالية: ${request.status}`,
      );
    }

    request.status = dto.newStatus;
    request.managerNotes = dto.managerNotes;
    request.decisionDate = new Date();

    const saved = await this.reqRepo.save(request);
    this.events.emit('resignation.decided', {
      tenantId,
      actorUserId,
      requestId: saved.id,
      employeeId: saved.employeeId,
      status: saved.status,
      notes: saved.managerNotes,
    });
    return saved;
  }

  async cancelMyRequest(
    employeeId: string,
    tenantId: string,
    actorUserId?: string,
  ): Promise<ResignationRequest> {
    const request = await this.reqRepo.findOne({
      where: { employeeId, tenantId, status: ResignationStatus.PENDING },
    });
    if (!request)
      throw new NotFoundException('لا يوجد طلب استقالة معلق لإلغائه');

    request.status = ResignationStatus.CANCELLED;
    const saved = await this.reqRepo.save(request);
    this.events.emit('resignation.cancelled', {
      tenantId,
      actorUserId,
      requestId: saved.id,
      employeeId,
    });
    return saved;
  }

  async findAll(
    tenantId: string,
    status?: ResignationStatus,
  ): Promise<ResignationRequest[]> {
    const where: FindOptionsWhere<ResignationRequest> = {
      tenantId,
      ...scopedEmployeeWhere(),
    };
    if (status) where.status = status;

    return this.reqRepo.find({
      where,
      relations: ['employee'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<ResignationRequest> {
    const request = await this.reqRepo.findOne({
      where: { id, tenantId },
      relations: ['employee'],
    });
    if (!request) throw new NotFoundException('طلب الاستقالة غير موجود');
    return request;
  }
}
