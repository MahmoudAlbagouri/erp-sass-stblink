// src/common/decorators/requires-feature.decorator.ts
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export interface FeatureMetadata {
  name: string;
  labelAr: string;
}

export const REQUIRES_FEATURE_KEY = 'requires_feature_key';
/** امتداد OpenAPI يحمل ميزة الباقة المطلوبة (انظر config/swagger.config) */
export const FEATURE_EXTENSION = 'x-feature';

// ✅ نفس نمط @Permissions - يقبل string أو object فيه labelAr
export const RequiresFeature = (feature: string | FeatureMetadata) =>
  applyDecorators(
    SetMetadata(
      REQUIRES_FEATURE_KEY,
      typeof feature === 'string' ? feature : feature.name,
    ),
    ApiExtension(
      FEATURE_EXTENSION,
      typeof feature === 'string'
        ? { name: feature, labelAr: feature }
        : feature,
    ),
  );
