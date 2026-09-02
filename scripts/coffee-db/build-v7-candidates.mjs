#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const core = JSON.parse(fs.readFileSync(path.resolve(ROOT,'coffee-qr-codebook/coffee_qr_codebook_v6.json'),'utf8'));
const snapshot = JSON.parse(fs.readFileSync(path.resolve(ROOT,'coffee-knowledge/catalog/wcr_catalog_snapshot_v1.json'),'utf8'));
const gap = JSON.parse(fs.readFileSync(path.resolve(ROOT,'coffee-knowledge/audits/variety_gap_analysis_v1.json'),'utf8'));
const outputArg = process.argv.slice(2).find((x)=>x.startsWith('--output='));
const outDir = outputArg ? path.resolve(outputArg.slice('--output='.length)) : path.resolve(ROOT,'.coffee-v7-candidates');
fs.mkdirSync(outDir,{recursive:true});

function normalize(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/coffea\s*canephora/g,'')
    .replace(/\bpanama\b/g,'')
    .replace(/[^a-z0-9]+/g,'')
    .trim();
}
function slug(value) {
  const ascii = String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'');
  return ascii.slice(0,24) || 'UNKNOWN';
}

const existing = new Map();
for (const row of core.varieties || []) {
  const code = String(row?.[0] || '');
  for (const value of row.slice(1,4)) {
    const key = normalize(value);
    if (key) existing.set(key,code);
  }
}
for (const row of core.aliases || []) {
  const target = String(row?.[0] || '');
  if (!target.startsWith('VA-')) continue;
  const key = normalize(row?.[1]);
  if (key && !existing.has(key)) existing.set(key,target);
}

const priorityNames = new Set((gap.firstPriorityMissingCandidates || []).map((x)=>normalize(x.name)));
const coreCodes = new Set((core.varieties || []).map((row)=>String(row?.[0] || '')));
const proposedCodes = new Set();
const present = [];
const candidates = [];

for (const name of snapshot.entries || []) {
  const key = normalize(name);
  if (!key) continue;
  const matchedCode = existing.get(key) || null;
  if (matchedCode) {
    present.push({name,matchedCoreCode:matchedCode});
    continue;
  }
  let proposedCode = `VA-V7-${slug(name)}`;
  let counter = 2;
  while (coreCodes.has(proposedCode) || proposedCodes.has(proposedCode)) proposedCode = `VA-V7-${slug(name).slice(0,20)}-${counter++}`;
  proposedCodes.add(proposedCode);
  const highPriority = priorityNames.has(key);
  const neutralDesignation = /^(?:[A-Z]{1,8}[\s.-]*\d|T\d|SL\d|Sln\.|BRS\s|IPR\s|INIFAP\s|NARO-|Roubi\s|TR\d|RAB\s|BP\s)/i.test(name);
  const selectionPotential = highPriority ? 0.95 : 0.55;
  const sourceAuthority = 1.0;
  const stability = 0.9;
  const score = Number((selectionPotential*0.45 + sourceAuthority*0.35 + stability*0.20).toFixed(3));
  candidates.push({
    entityType:'variety',
    nameEn:name,
    nameZhCandidate: neutralDesignation ? name : null,
    proposedCode,
    sourceAuthority:'A',
    sourceUrl:snapshot.sourceUrl,
    score,
    priority:highPriority ? 'high' : 'normal',
    bilingualStatus: neutralDesignation ? 'designation_language_neutral' : 'pending_zh_standardization',
    reviewStatus:'candidate_only',
    readyForCoreAppend:false,
    blockers:[
      ...(neutralDesignation ? [] : ['verified_zh_name_required']),
      'individual_catalog_record_and_lineage_review_required',
      'consumer_or_ocr_frequency_review_required'
    ]
  });
}

candidates.sort((a,b)=>b.score-a.score || a.nameEn.localeCompare(b.nameEn));
const result = {
  _format:'coffee-v7-variety-candidates',
  _schemaVersion:1,
  generatedAt:new Date().toISOString(),
  sourceSnapshot:{url:snapshot.sourceUrl,capturedAt:snapshot.capturedAt,entries:(snapshot.entries||[]).length},
  baseline:{coreVersion:String(core.version),coreVarieties:(core.varieties||[]).length},
  methodology:{
    matching:'NFKD + lowercase + punctuation/diacritic normalization + existing variety aliases; Panama/Coffea canephora qualifiers removed for identity comparison',
    score:'0.45*selectionPotential + 0.35*sourceAuthority + 0.20*stability',
    safety:'No candidate is readyForCoreAppend automatically. Individual record, bilingual name and use-frequency review remain mandatory.'
  },
  counts:{catalogEntries:(snapshot.entries||[]).length,matchedExisting:present.length,candidates:candidates.length,highPriority:candidates.filter((x)=>x.priority==='high').length,readyForCoreAppend:0},
  matchedExisting:present,
  candidates
};
fs.writeFileSync(path.join(outDir,'v7_variety_candidates.json'),`${JSON.stringify(result,null,2)}\n`,'utf8');
const report = [
  '# BrewIon v7 Variety Candidate Report','',
  `- WCR snapshot entries: ${result.counts.catalogEntries}`,
  `- Matched existing v6 variety/alias: ${result.counts.matchedExisting}`,
  `- Candidate gaps: ${result.counts.candidates}`,
  `- High-priority gaps: ${result.counts.highPriority}`,
  `- Automatically ready for append: 0`,'',
  'No candidate changes the v6 codebook. All candidates require individual authoritative-entry review and consumer/OCR relevance review before append-only v7 publication.',''
].join('\n');
fs.writeFileSync(path.join(outDir,'v7_candidate_report.md'),report,'utf8');
console.log(JSON.stringify(result.counts,null,2));
