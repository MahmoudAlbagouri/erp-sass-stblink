import { SetMetadata } from '@nestjs/common';

export const SKIP_DISCLAIMER_KEY = 'skipDisclaimer';

/** يستثني الراوت (أو الـ Controller كامل) من فحص DisclaimerGuard */
export const SkipDisclaimer = () => SetMetadata(SKIP_DISCLAIMER_KEY, true);
