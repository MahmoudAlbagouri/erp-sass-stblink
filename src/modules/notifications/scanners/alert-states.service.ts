// src/modules/notifications/scanners/alert-states.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * حالات قائمة (صنف تحت الحد، فاتورة متأخرة): يُنبَّه عند دخولها مرة، ويُحذف
 * سطرها عند زوالها فيُنبَّه من جديد إن عادت. الإدراج ذرّي (ON CONFLICT)، فدورتا
 * فحص متزامنتان لا تنبّهان مرتين.
 */
@Injectable()
export class AlertStatesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * القائم الآن تحت `prefix`: يُسجَّل الجديد منه ويُعاد (ليُنبَّه به)، وما زال
   * من قبل يُحذف.
   */
  async sync(
    tenantId: string,
    prefix: string,
    activeKeys: string[],
  ): Promise<string[]> {
    await this.dataSource.query(
      `DELETE FROM notification_alert_states
        WHERE "tenantId" = $1 AND left(key, length($2)) = $2
          AND NOT (key = ANY($3::text[]))`,
      [tenantId, prefix, activeKeys],
    );
    if (activeKeys.length === 0) return [];
    const raised = await this.dataSource.query<{ key: string }[]>(
      `INSERT INTO notification_alert_states (key, "tenantId")
       SELECT unnest($1::text[]), $2
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [activeKeys, tenantId],
    );
    return raised.map((r) => r.key);
  }

  /** تعذّر التنبيه: تُترك الحالات لتُعاد في الدورة القادمة */
  async release(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.dataSource.query(
      `DELETE FROM notification_alert_states WHERE key = ANY($1::text[])`,
      [keys],
    );
  }
}
