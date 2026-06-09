import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const storageConfig = (defaultFolder: string): MulterOptions => ({
  storage: diskStorage({
    destination: (req: any, file, cb) => {
      // سحب المجلد من الـ URL ديناميكياً
      const folder = (req.params.folder || defaultFolder) as string;
      const uploadPath = join(process.cwd(), 'uploads', folder);

      // إنشاء المجلد تلقائياً إذا لم يكن موجوداً
      if (!existsSync(uploadPath)) {
        mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(
        null,
        `${file.fieldname}-${uniqueSuffix}${extname(file.originalname)}`,
      );
    },
  }),
  fileFilter: (
    req: any,
    file: any,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
      return cb(
        new BadRequestException('فقط الصور (jpg, jpeg, png, webp) مسموح بها!'),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});
