import { Injectable, Logger } from '@nestjs/common';
import { join } from 'path';
import { promises as fs } from 'fs';

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  // --- الدالة الجديدة لجلب قائمة الملفات ---
  async getFilesByFolder(folder: string) {
    const folderPath = join(process.cwd(), 'uploads', folder);

    try {
      await fs.access(folderPath);
      const files = await fs.readdir(folderPath);

      // عدل الـ Regex هنا ليشمل pdf
      return files
        .filter((file) => /\.(jpg|jpeg|png|webp|gif|svg|pdf)$/i.test(file))
        .map((file) => ({
          filename: `${folder}/${file}`,
          url: `${folder}/${file}`,
        }));
    } catch {
      this.logger.error(`المجلد ${folder} غير موجود`);
      return [];
    }
  }

  async deleteFile(folder: string, fileName: string): Promise<boolean> {
    if (!fileName) return false;
    // ملاحظة: إذا كان الـ fileName يأتي بصيغة "products/name.jpg"
    // يجب التأكد أننا لا نكرر اسم المجلد في المسار
    const pureFileName = fileName.includes('/')
      ? fileName.split('/').pop()!
      : fileName;
    const filePath = join(process.cwd(), 'uploads', folder, pureFileName);

    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
      return true;
    } catch {
      this.logger.error(`الملف ${pureFileName} غير موجود في مجلد ${folder}`);
      return false;
    }
  }
}
