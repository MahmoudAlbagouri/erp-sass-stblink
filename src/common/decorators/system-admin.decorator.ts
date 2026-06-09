import { SetMetadata } from '@nestjs/common';

export const IS_SYSTEM_ADMIN_KEY = 'isSystemAdmin';
export const SystemAdmin = () => SetMetadata(IS_SYSTEM_ADMIN_KEY, true);
