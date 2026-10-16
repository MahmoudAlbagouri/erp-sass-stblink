// src/common/utils/status-transition.util.ts
import { BadRequestException } from '@nestjs/common';

/**
 * يتحقق من انتقال حالة يدوي (اعتماد، رفض، إيقاف…) على طلب: الحالة الجديدة من
 * القائمة، والانتقال مسموح من الحالة الحالية. يمنع مثلاً رفض سلفة سُلّمت
 * فعلاً، أو إعادة قرض مكتمل معلّقاً — وقيمة خاطئة تُرفض بـ 400 لا بخطأ قاعدة
 * بيانات.
 */
export function assertStatusTransition<S extends string>(
  current: S,
  next: unknown,
  allowed: Partial<Record<S, readonly S[]>>,
  labels: Record<S, string>,
): asserts next is S {
  if (typeof next !== 'string' || !(next in labels)) {
    throw new BadRequestException('حالة غير صالحة');
  }
  if (next === current) {
    throw new BadRequestException(`الحالة "${labels[current]}" بالفعل`);
  }
  if (!(allowed[current] ?? []).includes(next as S)) {
    throw new BadRequestException(
      `لا يمكن الانتقال من "${labels[current]}" إلى "${labels[next as S]}"`,
    );
  }
}
