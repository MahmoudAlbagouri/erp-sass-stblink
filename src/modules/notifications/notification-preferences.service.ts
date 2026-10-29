// src/modules/notifications/notification-preferences.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';
import { isMutableType, NOTIFICATION_TYPES } from './notification-types';

/** ما كتمه المستخدم من أنواع الإشعارات */
@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly repo: Repository<NotificationPreference>,
  ) {}

  async get(userId: string): Promise<{ mutedTypes: string[] }> {
    const pref = await this.repo.findOne({ where: { userId } });
    return { mutedTypes: pref?.mutedTypes ?? [] };
  }

  async update(
    userId: string,
    mutedTypes: string[],
  ): Promise<{ mutedTypes: string[] }> {
    const locked = mutedTypes.filter((key) => !isMutableType(key));
    if (locked.length) {
      throw new BadRequestException(
        `لا يمكن كتم: ${locked
          .map(
            (key) =>
              NOTIFICATION_TYPES[key as keyof typeof NOTIFICATION_TYPES]
                ?.label ?? key,
          )
          .join('، ')}`,
      );
    }
    const unique = [...new Set(mutedTypes)];
    await this.repo.upsert({ userId, mutedTypes: unique }, ['userId']);
    return { mutedTypes: unique };
  }
}
