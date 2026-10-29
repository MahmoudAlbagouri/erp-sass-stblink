// src/modules/files/file-rules.ts
// قواعد الملفات المرفوعة: أنواعها، وحجمها، وما يُقبل في كل تصنيف.

/** تصنيف الملف = غرض رفعه (مسار الرفع POST /files/:category) */
export const FILE_CATEGORIES = ['employee', 'contract', 'product'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB لكل ملف
export const MAX_FILES_PER_UPLOAD = 10;

export interface FileKind {
  mimeType: string;
  ext: string;
}

const IMAGE_KINDS = ['image/jpeg', 'image/png', 'image/webp'];
const DOCUMENT_KINDS = [...IMAGE_KINDS, 'application/pdf'];

/** ما يقبله كل تصنيف (صورة الصنف صورة فقط) */
export const ALLOWED_KINDS: Record<FileCategory, string[]> = {
  employee: DOCUMENT_KINDS,
  contract: DOCUMENT_KINDS,
  product: IMAGE_KINDS,
};

export const isFileCategory = (value: string): value is FileCategory =>
  (FILE_CATEGORIES as readonly string[]).includes(value);

/**
 * نوع الملف من بداياته (magic bytes) لا من اسمه أو مما يعلنه المتصفح: ملف HTML
 * باسم photo.png يُرفض بدل أن يُخدَّم بنوع خاطئ.
 */
export function detectFileKind(buffer: Buffer): FileKind | null {
  const starts = (bytes: number[], offset = 0) =>
    bytes.every((b, i) => buffer[offset + i] === b);

  if (starts([0xff, 0xd8, 0xff])) {
    return { mimeType: 'image/jpeg', ext: '.jpg' };
  }
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', ext: '.png' };
  }
  // RIFF....WEBP
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return { mimeType: 'image/webp', ext: '.webp' };
  }
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { mimeType: 'application/pdf', ext: '.pdf' };
  }
  return null;
}

/** اسم الملف كما رفعه المستخدم، بلا مسار ولا محارف تحكم */
export function cleanFileName(
  name: string | undefined,
  fallbackExt: string,
): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const safe = base.replace(/[\u0000-\u001f\u007f"<>|?*:]/g, '').trim();
  return (safe || `file${fallbackExt}`).slice(-200);
}
