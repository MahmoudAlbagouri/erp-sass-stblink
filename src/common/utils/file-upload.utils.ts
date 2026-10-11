import { diskStorage } from 'multer';
import type { Request } from 'express';
import { extname, join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

/** مقطع مسار آمن: يمنع ".." والفواصل وأي محارف غير متوقعة */
export const isSafePathSegment = (value: string): boolean =>
  /^[a-zA-Z0-9_-]+$/.test(value);

export const storageConfig = (defaultFolder: string): MulterOptions => ({
  storage: diskStorage({
    destination: (req: Request, file, cb) => {
      // سحب المجلد الأساسي من الـ URL (مثال: employees)
      const requested = req.params.folder;
      const folder =
        typeof requested === 'string' && requested ? requested : defaultFolder;
      // ✅ منع Path Traversal: اسم المجلد حروف/أرقام/شرطات فقط
      if (!isSafePathSegment(folder)) {
        return cb(new BadRequestException('اسم المجلد غير صالح'), '');
      }

      // تحديد المجلد الفرعي تلقائياً (image للصور، files للمستندات)
      const subFolder = file.mimetype.startsWith('image/') ? 'image' : 'files';

      // المسار النهائي: uploads/employees/image أو uploads/employees/files
      const uploadPath = join(process.cwd(), 'uploads', folder, subFolder);

      // إنشاء المسار بالكامل تلقائياً
      if (!existsSync(uploadPath)) {
        mkdirSync(uploadPath, { recursive: true });
      }
      cb(null, uploadPath);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(
        null,
        `${file.fieldname}-${uniqueSuffix}${extname(file.originalname)}`,
      );
    },
  }),
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    // التعديل: قبول الصور وملفات الـ PDF
    if (!file.mimetype.match(/\/(jpg|jpeg|png|webp|pdf)$/)) {
      return cb(
        new BadRequestException(
          'فقط الصور (jpg, jpeg, png, webp) وملفات PDF مسموح بها!',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});
