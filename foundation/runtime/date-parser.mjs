import { normalizeDisplayText, normalizeLocale } from './normalization-adapter.mjs';

export const COFFEE_DATE_DECISION_CONTRACT = 'coffee-date-decision/1.0';

const HAN_DIGITS = Object.freeze({
  '零': 0, '〇': 0, '○': 0, '◯': 0,
  '一': 1, '壹': 1, '二': 2, '贰': 2, '貳': 2, '两': 2, '兩': 2,
  '三': 3, '叁': 3, '參': 3, '四': 4, '肆': 4, '五': 5, '伍': 5,
  '六': 6, '陆': 6, '陸': 6, '七': 7, '柒': 7, '八': 8, '捌': 8,
  '九': 9, '玖': 9
});

const HAN_UNITS = Object.freeze({ '十': 10, '拾': 10, '百': 100, '佰': 100, '千': 1000, '仟': 1000 });
const KO_DIGITS = Object.freeze({ '영': 0, '공': 0, '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9 });
const KO_UNITS = Object.freeze({ '십': 10, '백': 100, '천': 1000 });

const EN_MONTHS = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
});

const ERAS = Object.freeze({
  '明治': { key: 'meiji', offset: 1867, start: '1868-01-25', end: '1912-07-29' },
  M: { key: 'meiji', offset: 1867, start: '1868-01-25', end: '1912-07-29' },
  '大正': { key: 'taisho', offset: 1911, start: '1912-07-30', end: '1926-12-24' },
  T: { key: 'taisho', offset: 1911, start: '1912-07-30', end: '1926-12-24' },
  '昭和': { key: 'showa', offset: 1925, start: '1926-12-25', end: '1989-01-07' },
  S: { key: 'showa', offset: 1925, start: '1926-12-25', end: '1989-01-07' },
  '平成': { key: 'heisei', offset: 1988, start: '1989-01-08', end: '2019-04-30' },
  H: { key: 'heisei', offset: 1988, start: '1989-01-08', end: '2019-04-30' },
  '令和': { key: 'reiwa', offset: 2018, start: '2019-05-01', end: null },
  R: { key: 'reiwa', offset: 2018, start: '2019-05-01', end: null }
});

const FIELD_LABELS = Object.freeze([
  { field: 'roastDate', re: /(?:烘焙(?:日期|日|时间|時間|于|於)?|焙煎(?:年月日|日付|日)|roast(?:ed)?\s*(?:date|on)?|roasting\s*date|로스팅\s*(?:날짜|일자|일)?|볶은\s*날짜)/iu },
  { field: 'productionDate', re: /(?:生产日期|生產日期|制造日期|製造日|製造年月日|production\s*date|manufactur(?:ed|ing)\s*(?:date|on)?|mfg\.?\s*date|제조\s*(?:일자|날짜|일))/iu },
  { field: 'bestBeforeDate', re: /(?:最佳赏味期|最佳賞味期|赏味期限|賞味期限|有效期|保质期|best\s*before|use\s*by|expiry\s*date|expiration\s*date|소비\s*기한|유통\s*기한)/iu }
]);

function uniqueStrings(values) {
  return [...new Set((values || []).map((value) => String(value)).filter(Boolean))];
}

function parseUnitNumber(text, digits, units) {
  const value = String(text || '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === '元') return 1;
  if (value === '廿' || value === '念') return 20;
  if (value === '卅') return 30;
  const chars = [...value];
  if (chars.every((char) => Object.hasOwn(digits, char)) && !chars.some((char) => Object.hasOwn(units, char))) {
    return Number(chars.map((char) => digits[char]).join(''));
  }
  let total = 0;
  let current = 0;
  let saw = false;
  for (const char of chars) {
    if (Object.hasOwn(digits, char)) {
      current = digits[char];
      saw = true;
    } else if (Object.hasOwn(units, char)) {
      total += (current || 1) * units[char];
      current = 0;
      saw = true;
    } else {
      return null;
    }
  }
  return saw ? total + current : null;
}

function parseHanNumber(value) {
  return parseUnitNumber(value, HAN_DIGITS, HAN_UNITS);
}

function parseKoNumber(value) {
  return parseUnitNumber(value, KO_DIGITS, KO_UNITS);
}

function iso(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return null;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const result = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const date = new Date(`${result}T00:00:00.000Z`);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return result;
}

function inferYear(month, day, referenceDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(referenceDate || ''));
  if (!match) return null;
  const reference = match[0];
  const year = Number(match[1]);
  const sameYear = iso(year, month, day);
  if (sameYear && sameYear <= reference) return sameYear;
  return iso(year - 1, month, day);
}

function normalizedInput(value) {
  return normalizeDisplayText(value)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\ufe55\uff1a]/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectedLabel(text) {
  for (const item of FIELD_LABELS) {
    const match = item.re.exec(text);
    if (match) return { field: item.field, text: match[0] };
  }
  return null;
}

function stripLabels(text) {
  let output = text;
  for (const item of FIELD_LABELS) output = output.replace(item.re, ' ');
  return output.replace(/^\s*(?:date|日期|日付|날짜)\s*[:：]?\s*/iu, '').replace(/^\s*[:：]\s*/, '').trim();
}

function numericOrder(options, rawLocale) {
  const requested = String(options.dateOrder || '').toUpperCase();
  if (['YMD', 'MDY', 'DMY'].includes(requested)) return requested;
  const locale = String(rawLocale || '').replaceAll('_', '-').toLowerCase();
  if (locale === 'en-us') return 'MDY';
  if (['en-gb', 'en-au', 'en-nz', 'en-ie', 'en-in'].includes(locale)) return 'DMY';
  return null;
}

function makeCandidate({ year = null, month = null, day = null, calendar = 'gregory', pattern, yearSource = year == null ? 'missing' : 'explicit', era = null }) {
  return {
    canonicalDate: year == null ? null : iso(year, month, day),
    components: { year, month, day },
    calendar,
    pattern,
    yearSource,
    ...(era ? { era } : {})
  };
}

function hasEraPrefix(text, index) {
  const prefix = text.slice(0, index);
  const era = '(?:令和|平成|昭和|大正|明治|民國|民国|[RHSTM])';
  const year = '[0-9G元零〇○◯一二三四五六七八九十百千壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]+';
  return new RegExp(`${era}(?:\\s*${year}\\s*年)?\\s*$`, 'iu').test(prefix);
}

function parseEastAsianMarked(text, candidates) {
  const han = '[0-9零〇○◯一二三四五六七八九十百千壹贰貳叁參肆伍陆陸柒捌玖拾佰仟两兩廿念卅]+';
  const re = new RegExp(`(?:(${han})\\s*年\\s*)?(${han})\\s*月\\s*(${han})\\s*(?:日|号|號)`, 'giu');
  for (const match of text.matchAll(re)) {
    if (hasEraPrefix(text, match.index)) continue;
    candidates.push(makeCandidate({
      year: match[1] ? parseHanNumber(match[1]) : null,
      month: parseHanNumber(match[2]),
      day: parseHanNumber(match[3]),
      pattern: match[1] ? 'east-asian-year-month-day' : 'east-asian-month-day'
    }));
  }
  const noDayMarker = new RegExp(`(${han})\\s*年\\s*(${han})\\s*月\\s*(${han})(?![0-9零〇○◯一二三四五六七八九十百千壹贰貳叁參肆伍陆陸柒捌玖拾佰仟两兩廿念卅日号號])`, 'giu');
  for (const match of text.matchAll(noDayMarker)) {
    if (hasEraPrefix(text, match.index)) continue;
    candidates.push(makeCandidate({
      year: parseHanNumber(match[1]), month: parseHanNumber(match[2]), day: parseHanNumber(match[3]),
      pattern: 'east-asian-year-month-day-no-day-marker'
    }));
  }

  const ko = '[0-9영공일이삼사오육칠팔구십백천]+';
  const koRe = new RegExp(`(?:(${ko})\\s*년\\s*)?(${ko})\\s*월\\s*(${ko})\\s*일`, 'giu');
  for (const match of text.matchAll(koRe)) {
    candidates.push(makeCandidate({
      year: match[1] ? parseKoNumber(match[1]) : null,
      month: parseKoNumber(match[2]),
      day: parseKoNumber(match[3]),
      pattern: match[1] ? 'korean-year-month-day' : 'korean-month-day'
    }));
  }
}

function parseJapaneseEra(text, candidates) {
  const number = '[0-9G元零〇○◯一二三四五六七八九十百千壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]+';
  const marked = new RegExp(`(令和|平成|昭和|大正|明治|[RHSTM])\\s*(${number})\\s*年\\s*(${number})\\s*月\\s*(${number})\\s*日`, 'giu');
  const short = /\b([RHSTM])\s*(\d{1,2}|G)[.\/-](\d{1,2})[.\/-](\d{1,2})\b/giu;
  for (const match of [...text.matchAll(marked), ...text.matchAll(short)]) {
    const era = ERAS[String(match[1]).toUpperCase()] || ERAS[match[1]];
    const eraYear = match[2] === '元' || String(match[2]).toUpperCase() === 'G' ? 1 : parseHanNumber(match[2]);
    const month = parseHanNumber(match[3]);
    const day = parseHanNumber(match[4]);
    const year = era && eraYear ? era.offset + eraYear : null;
    const value = iso(year, month, day);
    candidates.push({
      ...makeCandidate({ year, month, day, calendar: 'japanese', pattern: match[1].length === 1 ? 'japanese-era-short' : 'japanese-era', yearSource: 'era', era: era?.key || null }),
      eraValid: Boolean(value && era && value >= era.start && (!era.end || value <= era.end))
    });
  }
}

function parseMinguo(text, candidates) {
  const number = '[0-9零〇○◯一二三四五六七八九十百千壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]+';
  const marked = new RegExp(`(?:民國|民国)\\s*(${number})\\s*年\\s*(${number})\\s*月\\s*(${number})\\s*日`, 'giu');
  const short = /\bROC\s*(\d{1,3})[.\/-](\d{1,2})[.\/-](\d{1,2})\b/giu;
  for (const match of [...text.matchAll(marked), ...text.matchAll(short)]) {
    const rocYear = parseHanNumber(match[1]);
    const month = parseHanNumber(match[2]);
    const day = parseHanNumber(match[3]);
    const year = rocYear ? rocYear + 1911 : null;
    const value = iso(year, month, day);
    candidates.push({
      ...makeCandidate({ year, month, day, calendar: 'roc', pattern: /^ROC/i.test(match[0]) ? 'roc-short' : 'minguo', yearSource: 'era', era: 'minguo' }),
      eraValid: Boolean(value && value >= '1912-01-01')
    });
  }
}

function parseEnglishNamed(text, candidates) {
  const monthToken = '([A-Za-z]{3,9})\\.?';
  const dayToken = '(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?';
  const yearToken = '(\\d{4}|\\d{2})(?!\\d)';
  const patterns = [
    { re: new RegExp(`\\b${monthToken}\\s+${dayToken}(?:,?\\s+'?${yearToken})?\\b`, 'giu'), order: ['month', 'day', 'year'], name: 'english-month-day' },
    { re: new RegExp(`\\b${dayToken}(?:\\s+of)?\\s+${monthToken}(?:,?\\s+'?${yearToken})?\\b`, 'giu'), order: ['day', 'month', 'year'], name: 'english-day-month' },
    { re: new RegExp(`\\b${monthToken}[-/.]${dayToken}[-/.]${yearToken}\\b`, 'giu'), order: ['month', 'day', 'year'], name: 'english-month-day-separated' },
    { re: new RegExp(`\\b${dayToken}[-/.]${monthToken}[-/.]${yearToken}\\b`, 'giu'), order: ['day', 'month', 'year'], name: 'english-day-month-separated' },
    { re: new RegExp(`\\b(\\d{4})\\s+${monthToken}\\s+${dayToken}\\b`, 'giu'), order: ['year', 'month', 'day'], name: 'english-year-month-day' }
  ];
  for (const spec of patterns) {
    for (const match of text.matchAll(spec.re)) {
      if (spec.order[0] === 'month' && /\b\d{1,2}(?:st|nd|rd|th)?\s+$/iu.test(text.slice(0, match.index))) continue;
      const values = {};
      spec.order.forEach((key, index) => { values[key] = match[index + 1] ?? null; });
      const month = EN_MONTHS[String(values.month || '').toLowerCase()];
      if (!month) continue;
      const yearText = values.year;
      const year = yearText && yearText.length === 4 ? Number(yearText) : null;
      candidates.push(makeCandidate({
        year,
        month,
        day: Number(values.day),
        pattern: spec.name,
        yearSource: yearText?.length === 2 ? 'two-digit' : year == null ? 'missing' : 'explicit'
      }));
    }
  }
}

function parseNumeric(text, candidates, options, rawLocale) {
  for (const match of text.matchAll(/(?:^|[^\d])(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?!\d)/g)) {
    candidates.push(makeCandidate({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), pattern: 'numeric-ymd' }));
  }
  for (const match of text.matchAll(/(?:^|[^\d])(\d{8})(?!\d)/g)) {
    candidates.push(makeCandidate({ year: Number(match[1].slice(0, 4)), month: Number(match[1].slice(4, 6)), day: Number(match[1].slice(6, 8)), pattern: 'compact-ymd' }));
  }
  const order = numericOrder(options, rawLocale);
  for (const match of text.matchAll(/(?:^|[^\d])(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{2}|\d{4})(?!\d)/g)) {
    if (match[3].length === 4 && Number(match[3]) >= 1000 && Number(match[1]) <= 31 && Number(match[2]) <= 31) {
      const a = Number(match[1]), b = Number(match[2]), year = Number(match[3]);
      const possible = [];
      if (a <= 12 && b <= 31) possible.push({ month: a, day: b, pattern: 'numeric-mdy' });
      if (b <= 12 && a <= 31) possible.push({ month: b, day: a, pattern: 'numeric-dmy' });
      const preferred = order === 'MDY' ? possible.filter((item) => item.pattern.endsWith('mdy')) : order === 'DMY' ? possible.filter((item) => item.pattern.endsWith('dmy')) : possible;
      for (const item of preferred.length ? preferred : possible) candidates.push(makeCandidate({ year, ...item }));
    } else if (match[3].length === 2) {
      const a = Number(match[1]), b = Number(match[2]);
      const possible = [];
      if (a <= 12 && b <= 31) possible.push({ month: a, day: b, pattern: 'numeric-mdy' });
      if (b <= 12 && a <= 31) possible.push({ month: b, day: a, pattern: 'numeric-dmy' });
      const preferred = order === 'MDY' ? possible.filter((item) => item.pattern.endsWith('mdy')) : order === 'DMY' ? possible.filter((item) => item.pattern.endsWith('dmy')) : possible;
      for (const item of preferred.length ? preferred : possible) candidates.push(makeCandidate({ ...item, yearSource: 'two-digit' }));
    }
  }
}

function dedupe(candidates) {
  const found = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.calendar}|${candidate.canonicalDate || ''}|${candidate.components.year ?? ''}|${candidate.components.month ?? ''}|${candidate.components.day ?? ''}|${candidate.yearSource}`;
    if (!found.has(key)) found.set(key, candidate);
  }
  return [...found.values()];
}

function resultBase(rawValue, normalizedValue, locale, field, label, evidenceRefs) {
  return {
    schemaVersion: COFFEE_DATE_DECISION_CONTRACT,
    field,
    rawValue,
    normalizedValue,
    locale,
    detectedLabel: label,
    status: 'unknown',
    reason: 'no-date-match',
    canonicalDate: null,
    precision: 'unknown',
    calendar: 'unknown',
    components: { year: null, month: null, day: null },
    candidates: [],
    assumptions: [],
    evidenceRefs: uniqueStrings(evidenceRefs)
  };
}

export function parseCoffeeDate(value, options = {}) {
  const rawValue = value == null ? '' : String(value);
  const normalizedValue = normalizedInput(rawValue);
  const locale = normalizeLocale(options.locale, 'en');
  const field = String(options.field || 'genericDate');
  const label = detectedLabel(normalizedValue);
  const base = resultBase(rawValue, normalizedValue, locale, field, label, options.evidenceRefs);
  if (!normalizedValue) return base;
  if (/(?:农历|農曆|lunar\s*(?:calendar|date)?|旧历|舊曆|음력)/iu.test(normalizedValue)) {
    return { ...base, status: 'review', reason: 'unsupported-non-gregorian-calendar', assumptions: ['calendar-conversion-not-attempted'] };
  }
  if (/(?:今天|今日|昨天|昨日|前天|today|yesterday|day\s+before\s+yesterday|今日|昨日|一昨日|오늘|어제|그제)/iu.test(normalizedValue)) {
    return { ...base, status: 'review', reason: 'relative-date-requires-explicit-date', assumptions: ['relative-date-not-converted'] };
  }
  const labelMismatch = Boolean(label && field !== 'genericDate' && label.field !== field);
  const enforceLabel = (decision) => {
    if (!labelMismatch || decision.status === 'unknown') return decision;
    const assumptions = uniqueStrings([...(decision.assumptions || []), `detected-${label.field}`, 'date-label-field-mismatch']);
    return decision.status === 'confirmed'
      ? { ...decision, status: 'review', reason: 'date-label-field-mismatch', assumptions }
      : { ...decision, assumptions };
  };

  const text = stripLabels(normalizedValue);
  const candidates = [];
  parseJapaneseEra(text, candidates);
  parseMinguo(text, candidates);
  parseEastAsianMarked(text, candidates);
  parseEnglishNamed(text, candidates);
  parseNumeric(text, candidates, options, options.locale);

  let valid = dedupe(candidates).filter((candidate) => {
    const { year, month, day } = candidate.components;
    return Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 31 && (year == null || candidate.canonicalDate);
  });
  if (candidates.length && !valid.length) return enforceLabel({ ...base, status: 'invalid', reason: 'invalid-calendar-date', candidates: dedupe(candidates) });

  const eraInvalid = valid.filter((candidate) => ['japanese', 'roc'].includes(candidate.calendar) && candidate.eraValid === false);
  valid = valid.filter((candidate) => !['japanese', 'roc'].includes(candidate.calendar) || candidate.eraValid !== false);
  if (!valid.length && eraInvalid.length) return enforceLabel({ ...base, status: 'invalid', reason: 'date-outside-calendar-era', candidates: eraInvalid });

  const explicit = valid.filter((candidate) => candidate.canonicalDate && candidate.yearSource !== 'two-digit');
  const distinctExplicit = new Map(explicit.map((candidate) => [candidate.canonicalDate, candidate]));
  if (distinctExplicit.size > 1) {
    return enforceLabel({ ...base, status: 'conflict', reason: 'ambiguous-date-order-or-multiple-dates', candidates: [...distinctExplicit.values()] });
  }
  if (distinctExplicit.size === 1) {
    const selected = [...distinctExplicit.values()][0];
    return enforceLabel({
      ...base,
      status: 'confirmed', reason: 'unambiguous-explicit-date', canonicalDate: selected.canonicalDate,
      precision: 'day', calendar: selected.calendar, components: selected.components, candidates: [selected]
    });
  }

  const partial = valid.filter((candidate) => candidate.components.month && candidate.components.day);
  const distinctPartial = new Map(partial.map((candidate) => [`${candidate.components.month}-${candidate.components.day}`, candidate]));
  if (distinctPartial.size > 1) return enforceLabel({ ...base, status: 'conflict', reason: 'ambiguous-date-order', candidates: [...distinctPartial.values()] });
  if (distinctPartial.size === 1) {
    const selected = [...distinctPartial.values()][0];
    if (selected.yearSource === 'two-digit') {
      return enforceLabel({ ...base, status: 'review', reason: 'two-digit-year-requires-confirmation', precision: 'month-day', calendar: selected.calendar, components: selected.components, candidates: [selected] });
    }
    const inferred = options.inferMissingYear === true ? inferYear(selected.components.month, selected.components.day, options.referenceDate) : null;
    if (inferred) {
      const inferredCandidate = { ...selected, canonicalDate: inferred, components: { ...selected.components, year: Number(inferred.slice(0, 4)) }, yearSource: 'reference' };
      return enforceLabel({
        ...base, status: 'review', reason: 'year-inferred-from-reference-requires-confirmation', canonicalDate: inferred,
        precision: 'day', calendar: selected.calendar, components: inferredCandidate.components,
        candidates: [inferredCandidate], assumptions: [`most-recent-date-on-or-before-${options.referenceDate}`]
      });
    }
    return enforceLabel({ ...base, status: 'review', reason: 'missing-year', precision: 'month-day', calendar: selected.calendar, components: selected.components, candidates: [selected] });
  }
  return base;
}
