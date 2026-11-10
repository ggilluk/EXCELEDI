import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELIMITERS,
  ediToExcel,
  excelToEdi,
  getDefaultRegistry,
  parseColumnKey,
  serializeSegment,
  StructureError,
  WorkbookFormatError,
} from '../src/index';
import { cellText } from '../src/excel/read';
import { syntheticMessage } from './helpers/synthetic';

const fixtures = join(__dirname, 'fixtures');
const read = (f: string) => readFileSync(join(fixtures, f), 'latin1');
const registry = getDefaultRegistry();

async function reload(xlsx: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx as unknown as ExcelJS.Buffer);
  return wb;
}

/** Finds a column by its key prefix (e.g. "EQD 020.1") in the header row 2. */
function column(ws: ExcelJS.Worksheet, key: string): number {
  let found = 0;
  ws.getRow(2).eachCell((c, n) => {
    if (cellText(c.value) === key || cellText(c.value).startsWith(`${key} `)) found = n;
  });
  if (!found) throw new Error(`column ${key} not found in ${ws.name}`);
  return found;
}

function rowByPath(ws: ExcelJS.Worksheet, path: string): ExcelJS.Row {
  for (let r = 3; r <= ws.rowCount; r++) if (cellText(ws.getRow(r).getCell(1).value) === path) return ws.getRow(r);
  throw new Error(`row ${path} not found in ${ws.name}`);
}

describe('column keys', () => {
  it('parses segment, occurrence, element, repetition and component positions', () => {
    expect(parseColumnKey('EQD 020.1 Equipment identifier')).toMatchObject({ tag: 'EQD', occurrence: 1, elementIndex: 1, repetition: 1, componentIndex: 0, composite: true });
    expect(parseColumnKey('MEA[2] 030.2 Measure')).toMatchObject({ tag: 'MEA', occurrence: 2, elementIndex: 2, componentIndex: 1 });
    expect(parseColumnKey('COM[1] 010*3.2 Communication means type code')).toMatchObject({ tag: 'COM', elementIndex: 0, repetition: 3, componentIndex: 1 });
    expect(parseColumnKey('DTM@00180 010.1 x')).toMatchObject({ tag: 'DTM', at: '00180' });
    expect(parseColumnKey('BGM 030 Message function code')).toMatchObject({ elementIndex: 2, composite: false });
    expect(parseColumnKey('Path')).toBeUndefined();
  });
});

describe('EDI -> Excel -> EDI', () => {
  const files = readdirSync(fixtures).filter((f) => f.endsWith('.edi'));

  it.each(files)('round-trips %s unchanged', async (file) => {
    const edi = read(file);
    const toXlsx = await ediToExcel(edi);
    expect(toXlsx.issues).toEqual([]);
    const back = await excelToEdi(toXlsx.xlsx);
    expect(back.edi).toBe(edi);
    expect(back.issues).toEqual([]);
  });

  describe('every container message of every bundled directory', () => {
    const cases = registry.directories().flatMap((d) => registry.messageTypes(d).map((t) => [d, t] as const));
    it.each(cases)('%s %s: all segments, groups, elements and components', async (dir, type) => {
      const def = registry.message(dir, type);
      const d = { ...DEFAULT_DELIMITERS, repetition: '*' };
      const segments = syntheticMessage(def, registry, 'M1', 2);
      const edi = [
        "UNA:+.?*'",
        "UNB+UNOC:4+SENDER+RECIPIENT+20211115:1200+IC1'",
        ...segments.map((s) => serializeSegment(s, d)),
        "UNZ+1+IC1'",
        '',
      ].join('\n');
      const toXlsx = await ediToExcel(edi);
      expect(toXlsx.issues).toEqual([]);
      const back = await excelToEdi(toXlsx.xlsx);
      expect(back.edi).toBe(edi);
    });
  });
});

describe('workbook layout', () => {
  it('writes one sheet per segment table level with spec-derived headers', async () => {
    const { xlsx } = await ediToExcel(read('BAPLIE_D21B.edi'));
    const wb = await reload(xlsx);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Info', 'Interchange', 'BAPLIE', 'BAPLIE SG1', 'BAPLIE SG2', 'BAPLIE SG3', 'BAPLIE SG4', 'BAPLIE SG5',
      'BAPLIE SG6', 'BAPLIE SG7', 'BAPLIE SG8', 'BAPLIE SG9', 'BAPLIE SG11', 'BAPLIE SG12',
    ]);
    const sg7 = wb.getWorksheet('BAPLIE SG7')!;
    expect(cellText(sg7.getRow(2).getCell(1).value)).toBe('Path');
    expect(cellText(sg7.getRow(2).getCell(3).value)).toBe('EQD 020.1 Equipment identifier');
    expect(sg7.getRow(2).getCell(3).note).toContain('8260 Equipment identifier: C an..17');
    const containers = [3, 4, 5].map((r) => cellText(sg7.getRow(r).getCell(3).value));
    expect(containers).toEqual(['ABCU1234560', 'ABCU7654321', 'XYZU1112223']);
    expect(cellText(sg7.getRow(3).getCell(1).value)).toBe('M1/SG6#1/SG7#1');
    // released "?+" is stored unescaped; the second COM repetition gets its own columns
    const sg3 = wb.getWorksheet('BAPLIE SG3')!;
    expect(cellText(rowByPath(sg3, 'M1/SG2#1/SG3#1').getCell(column(sg3, 'COM[1] 010*2.1')).value)).toBe('+31104000000');
  });

  it('includes functional groups and every message of the interchange', async () => {
    const { xlsx } = await ediToExcel(read('CODECO_D95B.edi'));
    const wb = await reload(xlsx);
    const codeco = wb.getWorksheet('CODECO')!;
    expect(cellText(codeco.getRow(2).getCell(2).value)).toBe('Functional group');
    expect([3, 4].map((r) => `${cellText(codeco.getRow(r).getCell(1).value)} ${cellText(codeco.getRow(r).getCell(2).value)}`)).toEqual(['M1 G1', 'M2 G1']);
    expect(wb.getWorksheet('Groups')).toBeDefined();
  });

  it('adds columns for absent segments on request', async () => {
    const { xlsx } = await ediToExcel(read('BAPLIE_D95B.edi'), { allSegments: true });
    const wb = await reload(xlsx);
    expect(column(wb.getWorksheet('BAPLIE SG2')!, 'GID 010')).toBeGreaterThan(0);
  });
});

describe('editing in Excel', () => {
  it('applies edited values, added occurrences and recalculates control counts', async () => {
    const { xlsx } = await ediToExcel(read('BAPLIE_D95B.edi'));
    const wb = await reload(xlsx);

    // Change a container weight (SG2 MEA) ...
    const sg2 = wb.getWorksheet('BAPLIE SG2')!;
    rowByPath(sg2, 'M1/SG2#1').getCell(column(sg2, 'MEA[1] 030.2')).value = '23100';
    // ... and add a new stowage location with its container.
    const loc = sg2.getRow(sg2.rowCount + 1);
    loc.getCell(1).value = 'M1/SG2#5';
    loc.getCell(column(sg2, 'LOC@0130 010')).value = '147';
    loc.getCell(column(sg2, 'LOC@0130 020.1')).value = '0030282';
    loc.getCell(column(sg2, 'LOC@0130 020.3')).value = '5';
    loc.getCell(column(sg2, 'MEA[1] 010')).value = 'WT';
    loc.getCell(column(sg2, 'MEA[1] 030.1')).value = 'KGM';
    loc.getCell(column(sg2, 'MEA[1] 030.2')).value = 3900; // typed as a number in Excel
    loc.getCell(column(sg2, 'LOC@0210[1] 010')).value = '9';
    loc.getCell(column(sg2, 'LOC@0210[1] 020.1')).value = 'NLRTM';
    loc.getCell(column(sg2, 'LOC@0210[2] 010')).value = '11';
    loc.getCell(column(sg2, 'LOC@0210[2] 020.1')).value = 'DEHAM';
    loc.getCell(column(sg2, 'RFF 010.1')).value = 'BM';
    loc.getCell(column(sg2, 'RFF 010.2')).value = '1';
    const sg3 = wb.getWorksheet('BAPLIE SG3')!;
    const eqd = sg3.getRow(sg3.rowCount + 1);
    eqd.getCell(1).value = 'M1/SG2#5/SG3#1';
    eqd.getCell(column(sg3, 'EQD 010')).value = 'CN';
    eqd.getCell(column(sg3, 'EQD 020.1')).value = 'NEWU0000001';
    eqd.getCell(column(sg3, 'EQD 030.1')).value = '22G1';
    eqd.getCell(column(sg3, 'EQD 060')).value = '4';

    const out = await excelToEdi(wb);
    expect(out.issues).toEqual([]);
    const lines = out.edi.trim().split('\n');
    expect(lines).toContain("MEA+WT++KGM:23100'");
    expect(lines.slice(-8)).toEqual([
      "LOC+147+0030282::5'",
      "MEA+WT++KGM:3900'",
      "LOC+9+NLRTM'",
      "LOC+11+DEHAM'",
      "RFF+BM:1'",
      "EQD+CN+NEWU0000001+22G1+++4'",
      "UNT+53+0001'",
      "UNZ+1+BP0001'",
    ]);
  });

  it('reports validation problems introduced in Excel', async () => {
    const { xlsx } = await ediToExcel(read('VERMAS_D16A.edi'));
    const wb = await reload(xlsx);
    const sg4 = wb.getWorksheet('VERMAS SG4')!;
    rowByPath(sg4, 'M1/SG4#1').getCell(column(sg4, 'EQD 010')).value = null; // mandatory 8053
    const out = await excelToEdi(wb);
    expect(out.issues.map((i) => i.code)).toEqual(['MISSING_MANDATORY_ELEMENT']);
    expect(out.edi).toContain("EQD++ABCU1234560:6346:5+45G1:6346:5+++5'");
  });

  it('rejects rows that do not fit the message structure', async () => {
    const { xlsx } = await ediToExcel(read('BAPLIE_D95B.edi'));
    const wb = await reload(xlsx);
    const sg3 = wb.getWorksheet('BAPLIE SG3')!;
    sg3.getRow(sg3.rowCount + 1).getCell(1).value = 'M1/SG2#99/SG3#1';
    await expect(excelToEdi(wb)).rejects.toThrow(/does not fit the BAPLIE structure/);

    const wb2 = await reload(xlsx);
    wb2.getWorksheet('BAPLIE SG2')!.getRow(2).getCell(5).value = 'XYZ 010 bogus';
    await expect(excelToEdi(wb2)).rejects.toThrow(WorkbookFormatError);
  });

  it('refuses EDI that cannot be represented losslessly', async () => {
    const edi = "UNB+UNOA:3+A+B+211115:1200+1'UNH+1+BAPLIE:D:95B:UN'BGM++X+9'QTY+1:1'UNT+4+1'UNZ+1+1'";
    await expect(ediToExcel(edi)).rejects.toThrow(StructureError);
  });
});
