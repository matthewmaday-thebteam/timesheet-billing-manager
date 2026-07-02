// Run with: node --test scripts/expenses-tests/
// Path-gated validation against the user's REAL UniCredit English-UI export
// (Latin DR/CR marks + English headers). Skips cleanly (with a logged notice)
// when the uploaded file is not present, so CI stays green off-box. The file is
// referenced by absolute path ONLY and is never copied into the repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { parseBankExport } from '../../src/lib/xls/parseBankExport.ts';

const REAL_FILE =
  '/home/mmaday/.claude/uploads/20ab9e30-fa0b-4bee-a425-225bcc037d9f/97effefe-report.xls';

const available = existsSync(REAL_FILE);
const skipReason = available ? false : 'real English export unavailable — skipping';
if (!available) console.log(`[real-english-export] ${skipReason}`);

// Minimal, independent re-extraction of the HTML grid so the beneficiary check
// is verified against the source rather than against the parser's own output.
function extractGrid(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html)) !== null) {
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cell = cellRe.exec(tr[1])) !== null) {
      cells.push(cell[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

const DEBIT = new Set(['ДТ', 'DR']);
const CREDIT = new Set(['КТ', 'CR']);

test('real English export: parses 812 rows, 747 Debit + 65 Credit', { skip: skipReason }, () => {
  const html = readFileSync(REAL_FILE, 'utf8');
  const { sourceFormat, rows } = parseBankExport(html);

  const debit = rows.filter((r) => r.entryType === 'Debit').length;
  const credit = rows.filter((r) => r.entryType === 'Credit').length;
  console.log(
    `[real-english-export] format=${sourceFormat} parsed=${rows.length} debit=${debit} credit=${credit}`,
  );

  assert.equal(sourceFormat, 'html_xls');
  assert.equal(rows.length, 812);
  assert.equal(debit, 747);
  assert.equal(credit, 65);
  assert.equal(debit + credit, rows.length);
});

test('real English export: beneficiary non-empty wherever the source has one', { skip: skipReason }, () => {
  const html = readFileSync(REAL_FILE, 'utf8');
  const { rows } = parseBankExport(html);

  // Independently count source beneficiaries: for each data row, anchor on the
  // entry-type mark and read beneficiary at anchor+2 (same offset the parser uses).
  const grid = extractGrid(html);
  let sourceBeneficiaries = 0;
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    let t = -1;
    for (let k = 5; k < cells.length; k++) {
      const v = cells[k].trim();
      if (DEBIT.has(v) || CREDIT.has(v)) {
        t = k;
        break;
      }
    }
    if (t < 6) continue;
    if ((cells[t + 2] ?? '').trim()) sourceBeneficiaries++;
  }

  const parsedBeneficiaries = rows.filter((r) => r.beneficiary != null && r.beneficiary !== '').length;
  console.log(
    `[real-english-export] source_beneficiaries=${sourceBeneficiaries} parsed_beneficiaries=${parsedBeneficiaries}`,
  );

  // No parsed beneficiary is an empty string (it must be a real value or null).
  for (const r of rows) {
    if (r.beneficiary != null) assert.notEqual(r.beneficiary, '', 'beneficiary must be non-empty when present');
  }
  // Every source beneficiary survives into the parsed output — none dropped.
  assert.equal(parsedBeneficiaries, sourceBeneficiaries);
  assert.ok(sourceBeneficiaries > 0, 'expected the real export to carry beneficiaries');
});
