// src/modules/notifications/notification-messages.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PERMS } from '../../common/constants/permissions';
import type { Paginated } from '../../common/dto/pagination.dto';
import type {
  MessageAudienceDto,
  SendMessageDto,
  SentMessagesQueryDto,
} from './dto/send-message.dto';
import {
  Audience,
  NotificationAudienceService,
} from './notification-audience.service';
import { NotifierService } from './notifier.service';
import {
  type AdminNotificationRow,
  type NotificationRecipientRow,
  NotificationsAdminService,
} from './notifications-admin.service';

/** جمهور يحتاج صلاحية الإرسال الجماعي */
const BROADCAST_KINDS = ['all', 'branches', 'departments'];
/** أسماء من لا حساب لهم تُعرض حتى هذا العدد */
const WITHOUT_ACCOUNT_SAMPLE = 20;

export interface MessageReach {
  /** حسابات سيصلها الإشعار */
  recipients: number;
  /** موظفون في الجمهور بلا حساب دخول: لا يصلهم */
  withoutAccount: {
    count: number;
    sample: { id: string; fullName: string; employeeCode: string }[];
  };
}

const can = (user: CurrentUserData, permission: string): boolean =>
  user.isSuperAdmin ||
  user.isSystemAdmin ||
  (user.permissions ?? []).includes(permission);

/**
 * رسائل الإدارة للموظفين: لموظفين بعينهم، أو فروع، أو أقسام، أو الجميع.
 * المقيَّد بفروع لا يراسل إلا موظفي فروعه.
 */
@Injectable()
export class NotificationMessagesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audience: NotificationAudienceService,
    private readonly notifier: NotifierService,
    private readonly admin: NotificationsAdminService,
  ) {}

  /** كم سيصل قبل الإرسال، ومن لن يصله لأنه بلا حساب */
  async preview(
    user: CurrentUserData,
    dto: MessageAudienceDto,
  ): Promise<MessageReach> {
    const tenantId = this.tenantOf(user);
    const target = await this.target(user, tenantId, dto);
    const recipients = (
      await this.audience.resolve(tenantId, [target.audience])
    ).filter((id) => id !== user.id);
    return {
      recipients: recipients.length,
      withoutAccount: await this.withoutAccount(tenantId, target.employeeIds),
    };
  }

  /**
   * `channel`: direct لموظفين بعينهم، وbroadcast للجميع أو فروع أو أقسام —
   * لكلٍّ مساره بصلاحيته، فلا يمر جمهور من مسار غير مساره.
   */
  async send(
    user: CurrentUserData,
    dto: SendMessageDto,
    channel: 'direct' | 'broadcast',
  ): Promise<MessageReach & { id: string }> {
    const isBroadcast = BROADCAST_KINDS.includes(dto.audience.kind);
    if (isBroadcast !== (channel === 'broadcast')) {
      throw new BadRequestException(
        isBroadcast
          ? 'الإرسال للجميع أو لفروع وأقسام من مسار الإرسال الجماعي'
          : 'الإرسال لموظفين بعينهم من مسار الرسائل المباشرة',
      );
    }
    const tenantId = this.tenantOf(user);
    const target = await this.target(user, tenantId, dto.audience);

    const result = await this.notifier.notify({
      tenantId,
      type: 'manager_message',
      severity: dto.severity ?? 'info',
      title: dto.title.trim(),
      body: dto.body.trim(),
      to: target.audience,
      exclude: [user.id],
      senderId: user.id,
      requiresAck: dto.requiresAck ?? false,
      data: { audience: dto.audience.kind },
      retentionDays: null,
    });
    if (!result.id) {
      throw new BadRequestException(
        'لا يوجد من يستلم الرسالة: لا حسابات دخول فعّالة لمن اخترتهم',
      );
    }

    return {
      id: result.id,
      recipients: result.recipients,
      withoutAccount: await this.withoutAccount(tenantId, target.employeeIds),
    };
  }

  /** الرسائل المرسلة: كلها لمن يرى كل الإشعارات، وإلا ما أرسله هو */
  sent(
    user: CurrentUserData,
    query: SentMessagesQueryDto,
  ): Promise<Paginated<AdminNotificationRow>> {
    return this.admin.list(this.tenantOf(user), {
      ...query,
      type: 'manager_message',
      senderId: can(user, PERMS.NOTIFICATION_VIEW_ALL.name)
        ? undefined
        : user.id,
    });
  }

  async recipients(
    user: CurrentUserData,
    id: string,
  ): Promise<NotificationRecipientRow[]> {
    const tenantId = this.tenantOf(user);
    if (!can(user, PERMS.NOTIFICATION_VIEW_ALL.name)) {
      const own = await this.dataSource.query<{ id: string }[]>(
        `SELECT id FROM notifications
          WHERE id = $1 AND "senderId" = $2 AND type = 'manager_message'`,
        [id, user.id],
      );
      if (!own[0]) throw new ForbiddenException('ليست رسالة أرسلتها');
    }
    return this.admin.recipients(tenantId, id);
  }

  private tenantOf(user: CurrentUserData): string {
    if (!user.tenantId) {
      throw new BadRequestException('الرسائل تُرسل من داخل شركة');
    }
    return user.tenantId;
  }

  /**
   * الجمهور المطلوب بعد قيود المرسل: من لا يملك الإرسال الجماعي يراسل
   * موظفين بعينهم فقط، والمقيَّد بفروع لا يتجاوز موظفي فروعه.
   * `employeeIds` = موظفو الجمهور (null = كل مستخدمي الشركة).
   */
  private async target(
    user: CurrentUserData,
    tenantId: string,
    dto: MessageAudienceDto,
  ): Promise<{ audience: Audience; employeeIds: string[] | null }> {
    if (
      BROADCAST_KINDS.includes(dto.kind) &&
      !can(user, PERMS.NOTIFICATION_BROADCAST.name)
    ) {
      throw new ForbiddenException(
        'الإرسال للجميع أو لفروع وأقسام يحتاج صلاحية الإرسال الجماعي',
      );
    }
    const ids = [...new Set(dto.ids ?? [])];
    if (dto.kind !== 'all' && ids.length === 0) {
      throw new BadRequestException('اختر من سيستلم الرسالة');
    }

    const restricted = user.isSuperAdmin ? [] : (user.branchIds ?? []);
    if (dto.kind === 'all' && restricted.length === 0) {
      return {
        audience: Audience.all(),
        employeeIds: await this.audience.employeeIdsOf(tenantId, {}),
      };
    }

    let employeeIds: string[];
    switch (dto.kind) {
      case 'all':
        employeeIds = await this.audience.employeeIdsOf(tenantId, {
          branchIds: restricted,
        });
        break;
      case 'branches':
        if (restricted.length && ids.some((id) => !restricted.includes(id))) {
          throw new ForbiddenException('لا تملك المراسلة خارج فروعك');
        }
        employeeIds = await this.audience.employeeIdsOf(tenantId, {
          branchIds: ids,
        });
        break;
      case 'departments':
        employeeIds = await this.audience.employeeIdsOf(tenantId, {
          departmentIds: ids,
          branchIds: restricted.length ? restricted : undefined,
        });
        break;
      case 'employees':
        employeeIds = await this.employeesInScope(tenantId, ids, restricted);
        break;
    }
    return { audience: Audience.employees(employeeIds), employeeIds };
  }

  /** موظفون من الشركة (ومن فروع المرسل إن كان مقيَّداً) */
  private async employeesInScope(
    tenantId: string,
    ids: string[],
    branchIds: string[],
  ): Promise<string[]> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM employees
        WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND "deletedAt" IS NULL
          AND (cardinality($3::uuid[]) = 0 OR branch_id = ANY($3::uuid[]))`,
      [tenantId, ids, branchIds],
    );
    if (rows.length < ids.length && branchIds.length) {
      throw new ForbiddenException('لا تملك مراسلة موظفين خارج فروعك');
    }
    return rows.map((r) => r.id);
  }

  private async withoutAccount(
    tenantId: string,
    employeeIds: string[] | null,
  ): Promise<MessageReach['withoutAccount']> {
    const list = await this.audience.employeesWithoutAccount(
      tenantId,
      employeeIds ?? [],
    );
    return {
      count: list.length,
      sample: list.slice(0, WITHOUT_ACCOUNT_SAMPLE),
    };
  }
}
