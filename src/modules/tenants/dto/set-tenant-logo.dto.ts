// src/modules/tenants/dto/set-tenant-logo.dto.ts
import { IsString, Matches, MaxLength } from 'class-validator';
import { LOGO_PATTERN, MAX_LOGO_LENGTH } from '../tenant-logo';

export class SetTenantLogoDto {
  /** الشعار صورةً مصغّرة: data:image/png;base64,… (أو jpeg / webp) */
  @IsString()
  @MaxLength(MAX_LOGO_LENGTH, {
    message: 'حجم الشعار كبير — اختر صورة أصغر',
  })
  @Matches(LOGO_PATTERN, {
    message: 'الشعار يجب أن يكون صورة PNG أو JPG أو WebP',
  })
  logo!: string;
}
