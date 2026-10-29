// src/modules/notifications/notification-stream.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';

/** نبضة كل 25 ثانية: تبقي الاتصال حياً خلف البروكسي (nginx يقطع بعد 60) */
const HEARTBEAT_MS = 25_000;
/** حد اتصالات المستخدم الواحد (تبويبات وأجهزة): الأقدم يُغلق */
const MAX_CONNECTIONS_PER_USER = 10;

/**
 * البث اللحظي (Server-Sent Events): كل تبويب مفتوح اتصال، والإشعار الجديد
 * يُكتب لكل اتصالات مستلميه فوراً. في الذاكرة — يكفي لنسخة سيرفر واحدة؛
 * أكثر من نسخة يحتاج ناقلاً بينها (Redis pub/sub) في push.
 */
@Injectable()
export class NotificationStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationStreamService.name);
  private readonly clients = new Map<string, Set<Response>>();
  private readonly heartbeat = setInterval(
    () => this.broadcastComment('ping'),
    HEARTBEAT_MS,
  );

  constructor() {
    this.heartbeat.unref();
  }

  /** يسجّل اتصالاً ويعيد دالة إزالته (تُستدعى عند انقطاعه) */
  register(userId: string, res: Response): () => void {
    let connections = this.clients.get(userId);
    if (!connections) {
      connections = new Set();
      this.clients.set(userId, connections);
    }
    if (connections.size >= MAX_CONNECTIONS_PER_USER) {
      const oldest = connections.values().next().value;
      if (oldest) {
        connections.delete(oldest);
        oldest.end();
      }
    }
    connections.add(res);

    return () => {
      const set = this.clients.get(userId);
      if (!set) return;
      set.delete(res);
      if (set.size === 0) this.clients.delete(userId);
    };
  }

  /** حدث لمستخدمين (الغائب عن الاتصال يجده في قائمته عند فتحها) */
  push(userIds: Iterable<string>, event: string, data: unknown): void {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const userId of userIds) {
      const connections = this.clients.get(userId);
      if (!connections) continue;
      for (const res of connections) this.write(res, frame);
    }
  }

  /** عدد المتصلين الآن (للتشخيص) */
  get connectedUsers(): number {
    return this.clients.size;
  }

  onModuleDestroy(): void {
    clearInterval(this.heartbeat);
    for (const connections of this.clients.values()) {
      for (const res of connections) res.end();
    }
    this.clients.clear();
  }

  private broadcastComment(text: string): void {
    const frame = `: ${text}\n\n`;
    for (const connections of this.clients.values()) {
      for (const res of connections) this.write(res, frame);
    }
  }

  private write(res: Response, frame: string): void {
    try {
      res.write(frame);
    } catch (error) {
      // اتصال مات قبل أن يصل حدث إغلاقه: يُزال هناك
      this.logger.debug(`stream write failed: ${(error as Error).message}`);
    }
  }
}
