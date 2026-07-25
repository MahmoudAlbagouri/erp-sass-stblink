import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ResignationRequest,
  ResignationStatus,
} from './entities/resignation.entity';
import { CreateResignationDto } from './dto/create-resignation.dto';
import { DecisionResignationDto } from './dto/decision-resignation.dto';
import { Employee } from '../employees/entities/employee.entity';

@Injectable()
export class ResignationsService {
  constructor(
    @InjectRepository(ResignationRequest)
    private reqRepo: Repository<ResignationRequest>,
    @InjectRepository(Employee) private empRepo: Repository<Employee>,
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

    return this.reqRepo.save(request);
  }

  async makeDecision(
    id: string,
    dto: DecisionResignationDto,
    managerId: string,
    tenantId: string,
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

    return this.reqRepo.save(request);
  }

  async cancelMyRequest(
    employeeId: string,
    tenantId: string,
  ): Promise<ResignationRequest> {
    const request = await this.reqRepo.findOne({
      where: { employeeId, tenantId, status: ResignationStatus.PENDING },
    });
    if (!request)
      throw new NotFoundException('لا يوجد طلب استقالة معلق لإلغائه');

    request.status = ResignationStatus.CANCELLED;
    return this.reqRepo.save(request);
  }

  async findAll(
    tenantId: string,
    status?: ResignationStatus,
  ): Promise<ResignationRequest[]> {
    const where: any = { tenantId };
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
