#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { analyseInterchange, ediToExcel, excelToEdi, formatIssue, getDefaultRegistry, type Issue } from './index';

const USAGE = `edifact-excel - UN/EDIFACT container messages <-> Excel

Usage:
  edifact-excel to-excel <input.edi> <output.xlsx> [--directory D21B] [--all-segments] [--strict]
  edifact-excel to-edi   <input.xlsx> <output.edi> [--directory D21B] [--no-recalculate] [--strict]
  edifact-excel validate <input.edi> [--directory D21B]
  edifact-excel list

Options:
  --directory <Dxxx>  Read messages with this UN directory instead of the one in UNH
  --all-segments      Add columns for all segments of each group, not only those present
  --no-recalculate    Keep UNT/UNE/UNZ counts as entered in the workbook
  --strict            Exit with code 2 when validation errors are found
`;

function report(issues: Issue[]): number {
  for (const i of issues) console.error(formatIssue(i));
  const errors = issues.filter((i) => i.severity === 'error').length;
  console.error(`${errors} error(s), ${issues.length - errors} warning(s)`);
  return errors;
}

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith('--') && a !== '--directory'));
  const dirIdx = argv.indexOf('--directory');
  const directory = dirIdx >= 0 ? argv[dirIdx + 1] : undefined;
  const args = argv.filter((a, i) => !a.startsWith('--') && (dirIdx < 0 || i !== dirIdx + 1));
  const [cmd, input, output] = args;
  const strict = flags.has('--strict');

  switch (cmd) {
    case 'to-excel': {
      if (!input || !output) break;
      const r = await ediToExcel(readFileSync(input), { directory, allSegments: flags.has('--all-segments') });
      writeFileSync(output, r.xlsx);
      console.error(`${input}: ${r.analysis.messages.map((m) => `${m.type} ${m.directory}`).join(', ')} -> ${output}`);
      const errors = report(r.issues);
      return strict && errors ? 2 : 0;
    }
    case 'to-edi': {
      if (!input || !output) break;
      const r = await excelToEdi(readFileSync(input), { directory, recalculateControls: !flags.has('--no-recalculate') });
      writeFileSync(output, r.bytes);
      console.error(`${input} -> ${output} (${r.analysis.messages.length} message(s))`);
      const errors = report(r.issues);
      return strict && errors ? 2 : 0;
    }
    case 'validate': {
      if (!input) break;
      const a = analyseInterchange(readFileSync(input), { directory });
      for (const m of a.messages) console.log(`message ${m.index}: ${m.type} ${m.def.version}:${m.def.release} - ${m.def.name}`);
      return report(a.issues) ? 2 : 0;
    }
    case 'list': {
      const reg = getDefaultRegistry();
      for (const d of reg.directories()) {
        console.log(`${d}: ${reg.messageTypes(d).join(' ')}`);
      }
      return 0;
    }
  }
  console.error(USAGE);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`${err.name}: ${err.message}`);
    process.exit(1);
  },
);
