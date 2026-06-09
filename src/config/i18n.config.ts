import {
  HeaderResolver,
  AcceptLanguageResolver,
  QueryResolver,
} from 'nestjs-i18n';
import * as path from 'path';

export const i18nConfig = {
  fallbackLanguage: 'ar',
  loaderOptions: {
    path: path.join(process.cwd(), 'dist/i18n/'),
    watch: true,
  },
  resolvers: [
    new HeaderResolver(['lang']),
    AcceptLanguageResolver,
    new QueryResolver(['lang']),
  ],
};
