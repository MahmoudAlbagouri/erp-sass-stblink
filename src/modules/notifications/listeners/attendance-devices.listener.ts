// src/modules/notifications/listeners/attendance-devices.listener.ts
// أمان أجهزة البصمة: الجهاز يُعرَّف برقمه التسلسلي فقط، فتغيّر عنوانه أو
// محاولة اتصال من عنوان غير مسموح قد تعني انتحاله لإرسال بصمات مزيفة.
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PERMS } from '../../../common/constants/permissions';
import type { DomainEventMap } from '../../../common/events/domain-events';
import { Audience } from '../notification-audience.service';
import { NotifierService } from '../notifier.service';

const EVENT = { async: true } as const;

@Injectable()
export class AttendanceDevicesListener {
  constructor(private readonly notifier: NotifierService) {}

  @OnEvent('attendance.device_ip_changed', EVENT)
  async onIpChanged(
    e: DomainEventMap['attendance.device_ip_changed'],
  ): Promise<void> {
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'device_security',
      severity: 'warning',
      title: `جهاز البصمة «${e.deviceName}» اتصل من عنوان جديد`,
      body: 'إن لم يُنقل الجهاز أو يتغير الإنترنت عندكم، فقد يكون رقمه مستخدماً من جهاز آخر — اقفل الجهاز على عنوانه من إعداداته',
      details: [
        { label: 'الجهاز', value: e.deviceName },
        { label: 'العنوان السابق', value: e.previousIp },
        { label: 'العنوان الجديد', value: e.ip },
      ],
      entity: { type: 'biometric_device', id: e.deviceId },
      link: '/dashboard/attendance',
      to: Audience.can(PERMS.BIOMETRIC_DEVICE_UPDATE.name, e.branchId),
      dedupeKey: `device_ip_changed:${e.deviceId}:${e.ip}`,
    });
  }

  @OnEvent('attendance.device_blocked', EVENT)
  async onBlocked(
    e: DomainEventMap['attendance.device_blocked'],
  ): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'device_security',
      severity: 'danger',
      title: `رُفض اتصال باسم جهاز البصمة «${e.deviceName}»`,
      body: 'جاء الاتصال من عنوان غير مسموح للجهاز، ولم تُقبل منه أي بصمة. إن كان الجهاز نفسه وتغيّر إنترنت الفرع، فحدّث عناوينه المسموحة',
      details: [
        { label: 'الجهاز', value: e.deviceName },
        { label: 'العنوان', value: e.ip ?? 'غير معروف' },
      ],
      entity: { type: 'biometric_device', id: e.deviceId },
      link: '/dashboard/attendance',
      to: Audience.can(PERMS.BIOMETRIC_DEVICE_UPDATE.name, e.branchId),
      dedupeKey: `device_blocked:${e.deviceId}:${e.ip ?? '-'}:${day}`,
    });
  }
}
