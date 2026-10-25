// Prints the questions Classeum would generate from an Excel file.
// Usage: npx tsx scripts/preview-event.ts templates/classeum-vocab-week1.xlsx [more files as the word bank...]
import { readFileSync } from 'node:fs';
import { importWorkbook } from '../src/server/excel';
import { generateEvent } from '../src/server/generate';

async function main() {
  const [file, ...bankFiles] = process.argv.slice(2);
  if (!file) {
    console.error('usage: npx tsx scripts/preview-event.ts <file.xlsx> [bank.xlsx...]');
    process.exit(1);
  }
  const result = await importWorkbook(readFileSync(file));
  for (const issue of result.issues) {
    console.log(`[${issue.level}] ${issue.sheet}${issue.row ? ` ${issue.row}행` : ''}${issue.column ? ` [${issue.column}]` : ''}: ${issue.message}`);
  }
  const bank = [];
  for (const b of bankFiles) bank.push(...(await importWorkbook(readFileSync(b))).words);
  const event = generateEvent({
    words: result.words,
    custom: result.questions,
    bank,
    askedBefore: new Set(bank.map((w) => w.key)),
    seed: 42,
    defaultSeconds: 10,
  });
  event.warnings.forEach((w) => console.log(`[warning] ${w}`));
  event.questions.forEach((q, i) => {
    const opts = q.options.map((o, j) => `${j === q.answerIndex ? '*' : ' '}${j + 1}.${o.label}`).join('  ');
    console.log(`${String(i + 1).padStart(2)} ${q.modeLabel.padEnd(6)} ${q.prompt}\n     ${opts || `(답: ${q.answers?.join(' | ')})`}`);
  });
  console.log(`\n${event.questions.length}문항, 다시 도전용 ${Object.keys(event.retry).length}개, 명단 ${result.roster.length}명`);
}

main();
