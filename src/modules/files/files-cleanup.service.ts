// src/modules/files/files-cleanup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { FilesService } from './files.service';

/** مهلة الملف المرفوع قبل اعتباره متروكاً (نموذج أُلغي بعد الرفع) */
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;

/**
 * يحذف الملفات التي لا يشير إليها أي سجل: رُفعت ولم يُحفظ نموذجها، أو
 * استُبدلت أو أُزيلت من سجلها.
 *
 * "يشير إليه" = أي مفتاح أجنبي في قاعدة البيانات نحو جدول files، تُقرأ من
 * فهرس Postgres نفسه — فعمود ملف جديد في أي موديول محميّ تلقائياً بلا تعديل هنا.
 */
@Injectable()
export class FilesCleanupService {
  private readonly logger = new Logger(FilesCleanupService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly files: FilesService,
  ) {}

  @Cron('30 3 * * *', { name: 'files-orphans' })
  async run(): Promise<void> {
    const removed = await this.removeOrphans();
    if (removed) this.logger.log(`حُذف ${removed} ملفاً متروكاً`);
  }

  async removeOrphans(
    olderThan = new Date(Date.now() - ORPHAN_AGE_MS),
  ): Promise<number> {
    const references = await this.dataSource.query<
      { tbl: string; col: string }[]
    >(
      `SELECT c.conrelid::regclass::text AS tbl, quote_ident(a.attname) AS col
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'files'::regclass`,
    );
    const unused = references
      .map(
        ({ tbl, col }) =>
          `NOT EXISTS (SELECT 1 FROM ${tbl} ref WHERE ref.${col} = f.id)`,
      )
      .join(' AND ');

    let total = 0;
    for (;;) {
      const gone = await this.dataSource.query<{ storageKey: string }[]>(
        `WITH gone AS (
           DELETE FROM files WHERE id IN (
             SELECT f.id FROM files f
              WHERE f."createdAt" < $1 ${unused ? `AND ${unused}` : ''}
              LIMIT ${BATCH})
           RETURNING "storageKey")
         SELECT "storageKey" FROM gone`,
        [olderThan],
      );
      await this.files.removeFromDisk(gone.map((row) => row.storageKey));
      total += gone.length;
      if (gone.length < BATCH) return total;
    }
  }
}
