export const NORMALIZATION_CONTRACT = 'coffee-normalization/1.0';

export const SUPPORTED_LOCALES = Object.freeze([
  'zh-Hans',
  'zh-Hant',
  'en',
  'ja',
  'ko'
]);

const LOCALE_ALIASES = Object.freeze({
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-hans': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  'zh-mo': 'zh-Hant',
  'zh-hant': 'zh-Hant',
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  ja: 'ja',
  'ja-jp': 'ja',
  ko: 'ko',
  'ko-kr': 'ko'
});

const DEFAULT_OCR_CORRECTIONS = Object.freeze({
  '烘培日期': '烘焙日期',
  '烘焙曰期': '烘焙日期',
  '烘焙日朗': '烘焙日期',
  '处埋法': '处理法',
  '處埋法': '處理法'
});

function asText(value) {
  return value == null ? '' : String(value);
}

export function normalizeLocale(value, fallback = 'en') {
  const key = asText(value).trim().replaceAll('_', '-').toLowerCase();
  return LOCALE_ALIASES[key] || (SUPPORTED_LOCALES.includes(value) ? value : fallback);
}

export function normalizeDisplayText(value) {
  return asText(value)
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeOcrText(value, corrections = DEFAULT_OCR_CORRECTIONS) {
  const display = normalizeDisplayText(value)
    .replace(/[﹕︰]/g, ':')
    .replace(/[｜丨]/g, '|');
  return corrections[display] || display;
}

export function normalizeMatchKey(value) {
  return normalizeOcrText(value)
    .toLocaleLowerCase('en-US')
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[·•・]/g, ' ')
    .replace(/[\s\-_'".,，。:：;；/\\()（）[\]【】{}]+/g, '')
    .trim();
}

export function normalizedValue(value, options = {}) {
  const raw = asText(value);
  const display = normalizeOcrText(raw, options.ocrCorrections || DEFAULT_OCR_CORRECTIONS);
  return Object.freeze({
    contract: NORMALIZATION_CONTRACT,
    raw,
    display,
    matchKey: normalizeMatchKey(display),
    locale: normalizeLocale(options.locale, options.fallbackLocale || 'en')
  });
}

export function createNormalizationAdapter(options = {}) {
  const ocrCorrections = Object.freeze({
    ...DEFAULT_OCR_CORRECTIONS,
    ...(options.ocrCorrections || {})
  });
  const locale = normalizeLocale(options.locale, options.fallbackLocale || 'en');
  return Object.freeze({
    contract: NORMALIZATION_CONTRACT,
    locale,
    normalizeDisplayText,
    normalizeOcrText: (value) => normalizeOcrText(value, ocrCorrections),
    normalizeMatchKey,
    normalize: (value, overrides = {}) => normalizedValue(value, {
      ...options,
      ...overrides,
      locale: overrides.locale || locale,
      ocrCorrections
    })
  });
}

