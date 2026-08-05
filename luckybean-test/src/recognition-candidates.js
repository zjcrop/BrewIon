const FIELD_TABLE = Object.freeze({
  countryCode: 'countries',
  regionCode: 'regions',
  entityCode: 'entities',
  varietyCode: 'varieties',
  processCode: 'processes',
  flavorCodes: 'flavors'
});

const FIELD_LABEL_INDEX = Object.freeze({
  countries: 1,
  regions: 2,
  entities: 3,
  varieties: 1,
  processes: 1,
  flavors: 4
});

const OCR_CONFUSIONS = Object.freeze({
  '0': 'OQ', O: '0Q', Q: '0O',
  '1': 'IL丨一', I: '1L丨', L: '1I',
  '2': 'Z', Z: '2',
  '5': 'S', S: '5',
  '8': 'B', B: '8',
  '埃': '唉挨', '塞': '寨秦春', '瑰': '桂', '夏': '厦',
  '水': '氺', '洗': '冼', '日': '曰', '晒': '哂',
  '蜜': '密', '处理': '处埋', '庄': '荘', '园': '圜'
});

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleUpperCase('zh-CN')
    .replace(/[‐‑‒–—―−﹣－]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/[\s_/·•、，,。.!！?？;；:：'’"“”()（）\[\]【】{}]/g, '');
}

function editDistance(a, b) {
  const left = [...normalize(a)];
  const right = [...normalize(b)];
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const lc = left[i - 1];
      const rc = right[j - 1];
      const confusion = OCR_CONFUSIONS[lc]?.includes(rc) || OCR_CONFUSIONS[rc]?.includes(lc);
      const cost = lc === rc ? 0 : confusion ? 0.28 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function similarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(0.98, 0.82 + Math.min(left.length, right.length) / Math.max(left.length, right.length) * 0.14);
  return Math.max(0, 1 - editDistance(left, right) / Math.max(left.length, right.length));
}

function termsForRow(table, row) {
  const labelIndex = FIELD_LABEL_INDEX[table] || 1;
  const values = [row?.[0], row?.[labelIndex], ...row.slice(1)]
    .filter(value => typeof value === 'string' && value && !['active', 'candidate'].includes(value));
  return [...new Set(values.flatMap(value => value.split(/[\/、,，;；|]/).map(item => item.trim()).filter(Boolean)))];
}

function relationshipAllowed(table, row, context = {}) {
  if (table === 'regions' && context.countryCode) return row?.[1] === context.countryCode;
  if (table === 'entities' && context.countryCode) return row?.[1] === context.countryCode || row?.[2] === context.countryCode;
  if (table === 'entities' && context.regionCode) return row?.[2] === context.regionCode || row?.[1] === context.regionCode;
  return true;
}

function evidenceFragments(value) {
  const text = String(value || '').normalize('NFKC');
  const fragments = text.split(/[\n\r|；;，,。:：]+/).map(item => item.trim()).filter(Boolean);
  return [...new Set([text.trim(), ...fragments].filter(Boolean))];
}

export function codebookCandidates(field, evidence, book, context = {}, limit = 5) {
  const table = FIELD_TABLE[field];
  if (!table || !Array.isArray(book?.[table])) return [];
  const fragments = evidenceFragments(evidence);
  const candidates = [];
  for (const row of book[table]) {
    if (!relationshipAllowed(table, row, context)) continue;
    const terms = termsForRow(table, row);
    let bestScore = 0;
    let matched = '';
    for (const term of terms) {
      for (const fragment of fragments) {
        const score = similarity(term, fragment);
        if (score > bestScore) { bestScore = score; matched = term; }
      }
    }
    if (bestScore < 0.42) continue;
    candidates.push({
      field,
      table,
      code: row[0],
      label: row[FIELD_LABEL_INDEX[table]] || row[1] || row[0],
      matched,
      score: Math.round(bestScore * 1000) / 1000
    });
  }
  candidates.sort((a, b) => b.score - a.score || String(a.label).localeCompare(String(b.label), 'zh-CN'));
  return candidates.slice(0, limit);
}

function firstNumber(value) {
  return Number(String(value || '').normalize('NFKC').replace(/[OoＯ]/g, '0').match(/-?\d+(?:\.\d+)?/)?.[0]);
}

export function scalarCandidates(field, evidence) {
  const text = String(evidence || '').normalize('NFKC');
  const candidates = [];
  const add = (value, label, score = 0.9) => {
    if (value === '' || value === null || value === undefined || Number.isNaN(value)) return;
    if (candidates.some(item => String(item.value) === String(value))) return;
    candidates.push({ field, value, label: String(label ?? value), score });
  };

  if (field === 'initialWeight') {
    const match = text.match(/(\d{1,5}(?:\.\d+)?)\s*(?:G|克|GRAMS?)/i);
    if (match) add(Number(match[1]), `${match[1]} g`, 0.98);
    const number = firstNumber(text);
    if (Number.isFinite(number) && number >= 1 && number <= 10000) add(number, `${number} g`, 0.72);
  } else if (field === 'altitude') {
    const match = text.match(/(\d{3,4})\s*(?:M|米)/i);
    if (match) add(Number(match[1]), `${match[1]} m`, 0.98);
  } else if (field === 'roastColor') {
    const match = text.match(/(?:AGTRON)?\s*(\d{2,3})/i);
    if (match && Number(match[1]) >= 20 && Number(match[1]) <= 150) add(Number(match[1]), `Agtron ${match[1]}`, 0.96);
  } else if (field === 'price') {
    const match = text.match(/[¥￥$]?\s*(\d+(?:\.\d+)?)/);
    if (match) add(Number(match[1]), match[1], 0.82);
  } else if (field === 'roastDate') {
    const match = text.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/);
    if (match) add(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`, `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`, 0.99);
  }
  return candidates;
}

export function fieldCandidates(field, evidence, book, context = {}, limit = 5) {
  const scalars = scalarCandidates(field, evidence);
  if (scalars.length) return scalars.slice(0, limit);
  return codebookCandidates(field, evidence, book, context, limit);
}

export function normalizeEvidenceValue(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[‐‑‒–—―−﹣－]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
