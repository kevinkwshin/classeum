// [엑셀로 받기]: words written into the teacher's own template (public/templates/week7.xlsx), so the file reads
// like the one they fill in each week and goes back in through [엑셀 올리기] unchanged. Only the 단어장 and 문항
// sheets are rewritten; every other part of the file is copied byte for byte.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { Question, Word } from '@/lib/types';
import { QUESTION_HEADERS, WORD_HEADERS, headerKey } from './excel';
import { db } from './store';
import { entryData, readZip, withData, writeZip } from './zip';

const TEMPLATE = join(process.cwd(), 'public', 'templates', 'week7.xlsx');

type Value = string | number | undefined;
/** One sheet row by canonical header (단어, 뜻, …), the names the importer reads. */
type Row = Record<string, Value>;

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] !== '#' ? (ENTITIES[e] ?? m) : String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))),
  );

/** XML 1.0 can't hold control characters or half an emoji; those are dropped, the rest escaped. */
function xmlText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g, (m) => (m.length === 2 ? m : ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const attr = (attrs: string, name: string) => new RegExp(`\\s${name}=["']([^"']*)["']`).exec(attrs)?.[1];
const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number): string => (n > 26 ? colName(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));
/** The template writes every element as x:row, x:c…; a file saved again by Excel has no prefix. */
const prefixOf = (xml: string, root: string) => new RegExp(`<(\\w+:)?${root}\\b`).exec(xml)?.[1] ?? '';

/** The visible text of an <si> or <is>: its runs joined, without phonetic guides. */
function runText(xml: string, p: string): string {
  const plain = xml.replace(new RegExp(`<${p}rPh\\b[\\s\\S]*?</${p}rPh>`, 'g'), '');
  return [...plain.matchAll(new RegExp(`<${p}t\\b[^>]*>([\\s\\S]*?)</${p}t>`, 'g'))].map((m) => unescapeXml(m[1])).join('');
}

interface Cell { col: number; attrs: string; xml: string; filled: boolean }
interface SheetRow { r: number; attrs: string; xml: string; cells: Map<number, Cell> }

function parseRows(sheetData: string, p: string): SheetRow[] {
  return [...sheetData.matchAll(new RegExp(`<${p}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${p}row>)`, 'g'))].map((m) => {
    const cells = new Map<number, Cell>();
    for (const c of (m[2] ?? '').matchAll(new RegExp(`<${p}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${p}c>)`, 'g'))) {
      const col = colIndex(/^[A-Z]+/.exec(attr(c[1], 'r') ?? '')?.[0] ?? '');
      if (col) cells.set(col, { col, attrs: c[1], xml: c[0], filled: !!c[2] || attr(c[1], 't') !== undefined });
    }
    return { r: Number(attr(m[1], 'r')), attrs: m[1], xml: m[0], cells };
  });
}

function cellXml(p: string, ref: string, style: string | undefined, v: Value): string {
  const s = style === undefined ? '' : ` s="${style}"`;
  if (typeof v === 'number' && Number.isFinite(v)) return `<${p}c r="${ref}"${s}><${p}v>${v}</${p}v></${p}c>`;
  if (typeof v === 'string' && v) {
    const t = xmlText(v);
    const space = /^\s|\s$|\s\s|[\t\n\r]/.test(t) ? ' xml:space="preserve"' : '';
    return `<${p}c r="${ref}"${s} t="inlineStr"><${p}is><${p}t${space}>${t}</${p}t></${p}is></${p}c>`;
  }
  return `<${p}c r="${ref}"${s}/>`;
}

/**
 * Empties the data rows below the header (the cells and their styles stay) and writes `rows` from row 2 down.
 * Columns are found by their header text, read the way the importer reads it.
 */
function fillSheet(xml: string, shared: string[], aliases: Record<string, string>, rows: Row[]): string {
  const p = prefixOf(xml, 'worksheet');
  const data = new RegExp(`(<${p}sheetData\\b[^>]*>)([\\s\\S]*?)(</${p}sheetData>)`).exec(xml);
  const all = data ? parseRows(data[2], p) : [];
  const header = all.find((r) => r.r === 1);
  if (!data || !header) throw new Error('template sheet has no header row');
  const cols = new Map<string, number>();
  for (const c of [...header.cells.values()].sort((a, b) => a.col - b.col)) {
    const v = unescapeXml(new RegExp(`<${p}v>([\\s\\S]*?)</${p}v>`).exec(c.xml)?.[1] ?? '');
    const t = attr(c.attrs, 't');
    const raw = ((t === 's' ? shared[Number(v)] : t === 'inlineStr' ? runText(c.xml, p) : v) ?? '').trim();
    const key = headerKey(raw);
    const name = Object.hasOwn(aliases, key) ? aliases[key] : Object.hasOwn(aliases, raw) ? aliases[raw] : undefined;
    if (name && !cols.has(name)) cols.set(name, c.col);
  }
  for (const row of rows) {
    for (const [name, v] of Object.entries(row)) if (v !== undefined && v !== '' && !cols.has(name)) throw new Error(`template has no '${name}' column`);
  }

  // Every written row takes the cell styles of the template's first data row, so rows past the prepared ones
  // (which carry fewer, plainer cells) look the same as the rest.
  const model = all.find((r) => r.r === header.r + 1);
  const byRow = new Map(all.map((r) => [r.r, r]));
  const written = new Map(rows.map((row, i) => [header.r + 1 + i, row]));
  const writeRow = (r: number, row: Row) => {
    const old = byRow.get(r);
    const values = new Map([...cols].map(([name, col]) => [col, row[name]]));
    const used = [...new Set([...(model?.cells.keys() ?? []), ...(old?.cells.keys() ?? []), ...values.keys()])].sort((a, b) => a - b);
    const cells = used.map((col) => cellXml(p, `${colName(col)}${r}`, attr(model?.cells.get(col)?.attrs ?? old?.cells.get(col)?.attrs ?? '', 's'), values.get(col)));
    const attrs = ((model ?? old)?.attrs ?? '').replace(/\s(r|spans)=["'][^"']*["']/g, '');
    const spans = used.length ? ` spans="${used[0]}:${used[used.length - 1]}"` : '';
    return `<${p}row r="${r}"${spans}${attrs}>${cells.join('')}</${p}row>`;
  };
  // Cleared cells keep everything but their type and content; rows without content stay as they were.
  const clearRow = (old: SheetRow) =>
    [...old.cells.values()].some((c) => c.filled)
      ? `<${p}row${old.attrs}>${[...old.cells.values()].map((c) => (c.filled ? `<${p}c${c.attrs.replace(/\st=["'][^"']*["']/, '')}/>` : c.xml)).join('')}</${p}row>`
      : old.xml;
  const numbers = [...new Set([...byRow.keys(), ...written.keys()])].sort((a, b) => a - b);
  const body = numbers.map((r) => (r <= header.r ? byRow.get(r)!.xml : written.has(r) ? writeRow(r, written.get(r)!) : clearRow(byRow.get(r)!))).join('');
  let out = xml.slice(0, data.index) + data[1] + body + data[3] + xml.slice(data.index + data[0].length);

  if (rows.length > 0) {
    const last = header.r + rows.length;
    out = out.replace(new RegExp(`(<${p}dimension\\b[^>]*ref=["'][A-Z]+\\d+:[A-Z]+)(\\d+)`), (m, head: string, end: string) => (Number(end) < last ? `${head}${last}` : m));
    // The template was saved scrolled down to row 26; open at the first row so the words are in view.
    const pane = new RegExp(`<${p}pane\\b[^>]*>`).exec(out)?.[0];
    if (pane) {
      const first = `${colName(Number(attr(pane, 'xSplit') ?? 0) + 1)}${Number(attr(pane, 'ySplit') ?? 0) + 1}`;
      out = out
        .replace(pane, pane.replace(/topLeftCell="[^"]*"/, `topLeftCell="${first}"`))
        .replace(new RegExp(`(<${p}selection\\b[^>]*?)activeCell="[^"]*"([^>]*?)sqref="[^"]*"`), `$1activeCell="${first}"$2sqref="${first}"`);
    }
  }
  return out;
}

function workbook(words: Row[], questions: Row[]): Buffer {
  const entries = readZip(readFileSync(TEMPLATE));
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = (path: string) => {
    const e = byName.get(path);
    if (!e) throw new Error(`template has no ${path}`);
    return entryData(e).toString('utf8');
  };
  const rels = new Map<string, { type: string; target: string }>();
  for (const m of read('xl/_rels/workbook.xml.rels').matchAll(/<(?:\w+:)?Relationship\b([^>]*)>/g)) {
    const target = attr(m[1], 'Target') ?? '';
    rels.set(attr(m[1], 'Id') ?? '', { type: attr(m[1], 'Type') ?? '', target: target.startsWith('/') ? target.slice(1) : posix.normalize(`xl/${target}`) });
  }
  const sst = [...rels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.target;
  const sstXml = sst ? read(sst) : '';
  const sp = prefixOf(sstXml, 'sst');
  const shared = [...sstXml.matchAll(new RegExp(`<${sp}si\\b[^>]*>([\\s\\S]*?)</${sp}si>`, 'g'))].map((m) => runText(m[1], sp));
  // Sheets by name as the importer finds them (spaces ignored), then the file each one is in.
  const sheets = new Map<string, string>();
  for (const m of read('xl/workbook.xml').matchAll(/<(?:\w+:)?sheet\b([^>]*)>/g)) {
    const target = rels.get(/\s\w+:id=["']([^"']*)["']/.exec(m[1])?.[1] ?? '')?.target;
    if (target) sheets.set(unescapeXml(attr(m[1], 'name') ?? '').replace(/\s+/g, ''), target);
  }
  const changed = new Map<string, Buffer>();
  for (const [sheet, aliases, rows] of [['단어장', WORD_HEADERS, words], ['문항', QUESTION_HEADERS, questions]] as const) {
    const path = sheets.get(sheet);
    if (!path) throw new Error(`template has no ${sheet} sheet`);
    const xml = read(path);
    const out = fillSheet(xml, shared, aliases, rows);
    if (out !== xml) changed.set(path, Buffer.from(out, 'utf8'));
  }
  return writeZip(entries.map((e) => (changed.has(e.name) ? withData(e, changed.get(e.name)!) : e)));
}

/** A file name Windows and macOS both take, at most 40 characters as the importer keeps for an event's name. */
export function fileBaseOf(name: string): string {
  let out = '';
  // A name cut in the middle of an emoji keeps half of it, which can't go into a header; drop such halves.
  const whole = name.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
  for (const ch of whole.replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()) {
    if (out.length + ch.length > 40) break;
    out += ch;
  }
  return out.replace(/[. ]+$/, '');
}

/** The file name names the event when it comes back; a name that can't be a file name goes in 세트 instead. */
function named(name: string, words: Row[], questions: Row[]) {
  const base = fileBaseOf(name) || '단어장';
  const set = name && base !== name ? name : undefined;
  const withSet = (rows: Row[]) => rows.map((r) => ({ ...r, 세트: set }));
  return { fileName: `${base}.xlsx`, data: workbook(withSet(words), withSet(questions)) };
}

/** Rows typed in [직접 작성하기], written as typed (other spellings after |, example with its [ ]). */
export function typedWorkbook(title: string, rows: { spelling: string; meaning: string; example: string }[]) {
  return named(title.trim(), rows.map((r) => ({ 단어: r.spelling, 뜻: r.meaning, 예문: r.example })), []);
}

function wordRow(w: Word): Row {
  return {
    단어: [w.spelling, ...w.altSpellings].join('|'),
    뜻: w.meaning,
    품사: w.pos,
    '헷갈리는 단어': w.confusables.map((c) => (c.meaning ? `${c.word}(${c.meaning})` : c.word)).join('; '),
    예문: w.example,
    '예문 뜻': w.exampleMeaning,
    '시간(초)': w.seconds,
    단원: w.unit,
    단어ID: w.key.startsWith('id:') ? w.key.slice(3) : undefined,
  };
}

function questionRow(q: Question): Row {
  const kind = q.mode === 'CUSTOM_OX' ? 'OX' : q.mode === 'CUSTOM_TEXT' ? '단답형' : '객관식';
  const row: Row = {
    문항ID: q.id.replace(/^custom:/, ''),
    유형: kind,
    문제: q.prompt,
    정답: kind === '객관식' ? q.answerIndex + 1 : kind === 'OX' ? q.options[q.answerIndex]?.label : (q.answers ?? []).join('|'),
    해설: q.explanation,
    '시간(초)': q.seconds,
  };
  q.options.slice(0, 4).forEach((o, i) => {
    if (kind === '객관식') row[`보기${i + 1}`] = o.label;
    row[`피드백${i + 1}`] = o.feedback;
  });
  return row;
}

/** A word whose record is gone, rebuilt from its question: the explanation keeps the whole meaning. */
function fromQuestion(key: string, q: Question): Word | null {
  const right = q.options[q.answerIndex]?.label ?? '';
  const spelling = q.mode === 'MEAN' ? q.prompt : right;
  const exp = q.explanation ?? '';
  const marker = `${spelling} = `;
  const at = q.mode === 'CLOZE' ? exp.indexOf(` · ${marker}`) + 3 : 0;
  if (!spelling || at < (q.mode === 'CLOZE' ? 3 : 0) || !exp.startsWith(marker, at)) return null;
  const example = q.mode === 'CLOZE' ? q.prompt.replace('_____', `[${right}]`) : undefined;
  return { key, spelling, altSpellings: [], meaning: exp.slice(at + marker.length), confusables: [], example, status: '사용' };
}

/**
 * An event's words and its own questions. Events keep questions, not the word list, so the words are the ones
 * asked, in the order they were first saved (an upload's order, for words new that week).
 */
export function eventWorkbook(eventId: string) {
  const d = db();
  const e = Object.hasOwn(d.events, eventId) ? d.events[eventId] : undefined;
  if (!e) return null;
  const rank = new Map(Object.keys(d.words).map((k, i) => [k, i]));
  const asked = new Map<string, Question>();
  for (const q of [...e.questions, ...Object.values(e.retry)]) if (q.wordKey && !asked.has(q.wordKey)) asked.set(q.wordKey, q);
  const words = [...asked]
    .map(([key, q], i) => ({ w: Object.hasOwn(d.words, key) ? d.words[key] : fromQuestion(key, q), at: rank.get(key) ?? rank.size + i }))
    .filter((x): x is { w: Word; at: number } => !!x.w)
    .sort((a, b) => a.at - b.at)
    .map((x) => wordRow(x.w));
  return named(e.name, words, e.questions.filter((q) => q.mode.startsWith('CUSTOM')).map(questionRow));
}
