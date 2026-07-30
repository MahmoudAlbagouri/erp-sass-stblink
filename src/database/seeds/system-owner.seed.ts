// src/database/seeds/system-owner.seed.ts
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { User } from '../../modules/users/entities/user.entity';
import { UserStatus } from '../../common/enums/user.enums';

export const seedSystemOwner = async (dataSource: DataSource) => {
  const userRepository = dataSource.getRepository(User);

  // 1. التحقق من وجود المالك مسبقاً
  const existingOwner = await userRepository.findOneBy({
    email: 'owner@saas-platform.com',
  });

  if (existingOwner) {
    console.log('✅ System Owner already exists.');
    return;
  }

  // 2. تشفير كلمة المرور
  const hashedPassword = await argon2.hash('SuperSecurePass123!');

  // 3. إنشاء المالك بدون ربطه بأي دور
  const systemOwner = userRepository.create({
    username: 'Platform Owner',
    email: 'owner@saas-platform.com',
    password: hashedPassword,
    isSystemAdmin: true,
    isSuperAdmin: false,
    tenantId: null,
    status: UserStatus.ACTIVE,
    // ✅ ترك roleId و role فارغين عمداً
  } as unknown as Partial<User>);

  await userRepository.save(systemOwner);
  console.log('👑 System Owner created successfully!');
};
