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
/** فاصل "أي ميزة من هذه تكفي" في قيمة المفتاح */
export const ANY_FEATURE_SEPARATOR = '|';

const nameOf = (feature: string | FeatureMetadata) =>
  typeof feature === 'string' ? feature : feature.name;
const labelOf = (feature: string | FeatureMetadata) =>
  typeof feature === 'string' ? feature : feature.labelAr;

/**
 * ميزة الباقة المطلوبة للمسار — نفس نمط @Permissions (string أو object فيه
 * labelAr). مصفوفة = تكفي أي واحدة منها (قوائم المكوّنات للمطاعم أو للمصانع).
 */
export const RequiresFeature = (
  feature: string | FeatureMetadata | (string | FeatureMetadata)[],
) => {
  const features = Array.isArray(feature) ? feature : [feature];
  const name = features.map(nameOf).join(ANY_FEATURE_SEPARATOR);
  return applyDecorators(
    SetMetadata(REQUIRES_FEATURE_KEY, name),
    ApiExtension(FEATURE_EXTENSION, {
      name,
      labelAr: features.map(labelOf).join(' أو '),
    }),
  );
};
