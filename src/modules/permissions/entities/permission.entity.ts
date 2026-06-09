// src/modules/permissions/entities/permission.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

export enum PermissionScope {
  SYSTEM = 'system',
  TENANT = 'tenant',
}

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({
    type: 'enum',
    enum: PermissionScope,
    default: PermissionScope.TENANT,
  })
  scope!: PermissionScope;

  @ManyToOne(() => Tenant, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  // ✅ التغيير الجوهري: السماح بـ null صراحةً
  @Column({ name: 'tenant_id', nullable: true, type: 'uuid' })
  tenantId?: string | null;
}
