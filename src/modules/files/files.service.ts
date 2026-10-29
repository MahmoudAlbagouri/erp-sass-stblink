import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { EntityManager, In, Repository } from 'typeorm';
import { StoredFile } from './entities/stored-file.entity';
import { FileUrlSigner } from './file-url.signer';
import {
  ALLOWED_KINDS,
  cleanFileName,
  detectFileKind,
  isFileCategory,
} from './file-rules';

/** مجلد التخزين (خارج أي خدمة ملفات ثابتة: الوصول بالروابط الموقَّعة فقط) */
export const filesRoot = (): string =>
  resolve(process.env.FILES_DIR || join(process.cwd(), 'uploads'));

const KIND_LABELS: Record<string, string> = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
};

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    @InjectRepository(StoredFile)
    private readonly repo: Repository<StoredFile>,
    private readonly signer: FileUrlSigner,
  ) {}

  /** يحفظ الملفات المرفوعة على القرص ويسجّلها لشركة الرافع */
  async store(
    uploads: Express.Multer.File[] | undefined,
    category: string,
    uploader: { id: string; tenantId: string | null },
  ): Promise<StoredFile[]> {
    if (!isFileCategory(category)) {
      throw new BadRequestException('تصنيف الملف غير صالح');
    }
    const tenantId = uploader.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('رفع الملفات لمستخدمي الشركات فقط');
    }
    if (!uploads?.length) throw new BadRequestException('لم يتم رفع أي ملفات');

    const allowed = ALLOWED_KINDS[category];
    const files = uploads.map((upload) => {
      const kind = detectFileKind(upload.buffer);
      if (!kind || !allowed.includes(kind.mimeType)) {
        const labels = allowed.map((type) => KIND_LABELS[type]).join(' / ');
        throw new BadRequestException(
          `الملف "${cleanFileName(upload.originalname, '')}" غير مقبول — المسموح: ${labels}`,
        );
      }
      const id = randomUUID();
      return {
        buffer: upload.buffer,
        entity: this.repo.create({
          id,
          tenantId,
          category,
          storageKey: `${tenantId}/${category}/${id}${kind.ext}`,
          originalName: cleanFileName(upload.originalname, kind.ext),
          mimeType: kind.mimeType,
          size: upload.size,
          uploadedById: uploader.id,
        }),
      };
    });

    const written: string[] = [];
    try {
      for (const file of files) {
        const path = this.pathOf(file.entity.storageKey);
        await fs.mkdir(dirname(path), { recursive: true });
        await fs.writeFile(path, file.buffer, { flag: 'wx' });
        written.push(path);
      }
      return await this.repo.save(files.map((file) => file.entity));
    } catch (error) {
      await Promise.all(written.map((path) => fs.rm(path, { force: true })));
      throw error;
    }
  }

  /**
   * الملفات المختارة لسجل، بشرط أن تكون لشركته: بدون هذا الفحص يستطيع مستخدم
   * ربط معرّف ملف شركة أخرى بسجله ثم فتحه. يعيدها بترتيب المعرّفات.
   */
  async resolve(
    ids: string[],
    tenantId: string,
    manager?: EntityManager,
  ): Promise<StoredFile[]> {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const repo = manager ? manager.getRepository(StoredFile) : this.repo;
    const found = await repo.findBy({ id: In(unique), tenantId });
    if (found.length !== unique.length) {
      throw new BadRequestException('ملف مرفق غير موجود أو لا يخص شركتك');
    }
    const byId = new Map(found.map((file) => [file.id, file]));
    return unique.map((id) => byId.get(id)!);
  }

  /** كل معرّف معطى (الفارغ يُتجاهل) ملف لهذه الشركة، وإلا 400 */
  async assertOwned(
    ids: (string | null | undefined)[],
    tenantId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const given = ids.filter((id): id is string => !!id);
    await this.resolve(given, tenantId, manager);
  }

  /** الملف ومساره لرابط موقَّع صالح */
  async openSigned(
    id: string,
    exp: unknown,
    sig: unknown,
  ): Promise<{ file: StoredFile; path: string }> {
    if (!this.signer.verify(id, exp, sig)) {
      throw new ForbiddenException('رابط الملف غير صالح أو انتهت صلاحيته');
    }
    const file = await this.repo.findOneBy({ id });
    if (!file) throw new NotFoundException('الملف غير موجود');

    const path = this.pathOf(file.storageKey);
    try {
      await fs.access(path);
    } catch {
      this.logger.error(`ملف مسجَّل غير موجود على القرص: ${file.storageKey}`);
      throw new NotFoundException('الملف غير موجود');
    }
    return { file, path };
  }

  /** يحذف ملفات من القرص (بعد حذف سجلاتها) */
  async removeFromDisk(storageKeys: string[]): Promise<void> {
    for (const key of storageKeys) {
      try {
        await fs.rm(this.pathOf(key), { force: true });
      } catch (error) {
        this.logger.warn(`تعذّر حذف ${key}: ${(error as Error).message}`);
      }
    }
  }

  /** المسار على القرص، ولا يُسمح بالخروج من مجلد التخزين */
  private pathOf(storageKey: string): string {
    const root = filesRoot();
    const path = resolve(root, storageKey);
    if (!path.startsWith(root + sep)) {
      throw new Error(`مسار ملف خارج مجلد التخزين: ${storageKey}`);
    }
    return path;
  }
}
