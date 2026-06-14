// src/common/decorators/protected-delete.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const PROTECTED_DELETE = 'protected_delete';
export const ProtectedDelete = () => SetMetadata(PROTECTED_DELETE, true);
