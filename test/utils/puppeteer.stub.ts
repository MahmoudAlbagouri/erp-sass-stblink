// بديل puppeteer في الاختبارات: الحزمة الحقيقية ESM فقط ولا يستطيع Jest تحميلها،
// وتوليد الـ PDF (متصفح حقيقي) خارج نطاق هذه الاختبارات أصلاً.
export const launch = (): never => {
  throw new Error(
    'puppeteer is stubbed in tests — PDF rendering is not available',
  );
};
