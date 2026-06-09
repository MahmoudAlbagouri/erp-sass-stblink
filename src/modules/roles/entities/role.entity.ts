// src/modules/roles/entities/role.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import {
  Permission,
  PermissionScope,
} from '../../permissions/entities/permission.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('roles')
export class Role {
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

  @ManyToMany(() => Permission)
  @JoinTable()
  permissions!: Permission[];

  @ManyToOne(() => Tenant, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  // ✅ التغيير الجوهري: السماح بـ null صراحةً
  @Column({ name: 'tenant_id', nullable: true, type: 'uuid' })
  tenantId?: string | null;
}
