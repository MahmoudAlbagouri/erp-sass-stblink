// src/common/decorators/requires-feature.decorator.ts
import { SetMetadata } from '@nestjs/common';

export interface FeatureMetadata {
  name: string;
  labelAr: string;
}

export const REQUIRES_FEATURE_KEY = 'requires_feature_key';

// ✅ نفس نمط @Permissions - يقبل string أو object فيه labelAr
export const RequiresFeature = (feature: string | FeatureMetadata) =>
  SetMetadata(
    REQUIRES_FEATURE_KEY,
    typeof feature === 'string' ? feature : feature.name,
  );
