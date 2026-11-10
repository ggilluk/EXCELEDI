import { describe, expect, it } from 'vitest';
import { analyseInterchange } from '../src/document';
import type { Issue } from '../src/edifact/issues';

const wrap = (body: string[], unh = 'UNH+1+BAPLIE:D:21B:UN') => {
  const segs = [unh, ...body];
  return ["UNA:+.?*'", "UNB+UNOC:4+A+B+20211115:1200+1", ...segs, `UNT+${segs.length + 1}+1`, 'UNZ+1+1'].map((s) => (s.startsWith('UNA') ? s : `${s}'`)).join('\n');
};
const codes = (issues: Issue[]) => issues.map((i) => `${i.code}${i.tag ? ` ${i.tag}` : ''}${i.element ? ` ${i.element}` : ''}`);

const header = ["BGM+658+X+9", 'TDT+20+1', 'UNS+D'];

describe('message structure (segment table)', () => {
  it('nests LOC in SG8 until CNT closes the SG6 occurrence (D.21B BAPLIE)', () => {
    const a = analyseInterchange(
      wrap([...header, 'LOC+147+0010282', 'EQD+CN+A', 'LOC+9+NLRTM', 'LOC+11+DEHAM', 'CNT+16:1', 'LOC+147+0010484', 'CNT+16:0']),
    );
    expect(a.issues).toEqual([]);
    const root = a.messages[0].tree.root;
    const sg6 = root.entries.filter((e) => e.kind === 'group' && e.node.id === 'SG6');
    expect(sg6).toHaveLength(2);
    const paths: string[] = [];
    const walk = (i: typeof root) => i.entries.forEach((e) => (e.kind === 'group' ? (paths.push(e.instance.path), walk(e.instance)) : undefined));
    walk(root);
    expect(paths).toEqual(['SG4#1', 'SG6#1', 'SG6#1/SG7#1', 'SG6#1/SG7#1/SG8#1', 'SG6#1/SG7#1/SG8#2', 'SG6#2']);
  });

  it('reports missing mandatory segments and groups', () => {
    // SG4 (TDT, M 9) and UNS (M 1) are mandatory; CNT is mandatory in SG6.
    const a = analyseInterchange(wrap(['BGM+658+X+9', 'LOC+147+0010282']));
    expect(codes(a.issues)).toEqual(['MISSING_MANDATORY_GROUP', 'MISSING_MANDATORY_SEGMENT UNS', 'MISSING_MANDATORY_SEGMENT CNT']);
  });

  it('reports segments repeated more often than allowed', () => {
    const dtm = Array.from({ length: 10 }, (_, i) => `DTM+137:2021111${i}:102`);
    const a = analyseInterchange(wrap(['BGM+658+X+9', ...dtm, 'TDT+20+1', 'UNS+D']));
    expect(codes(a.issues)).toEqual(['SEGMENT_REPEATED_TOO_OFTEN DTM']);
  });

  it('reports segments that do not belong to the message', () => {
    const a = analyseInterchange(wrap([...header, 'QTY+1:1']));
    expect(codes(a.issues)).toEqual(['UNEXPECTED_SEGMENT QTY']);
  });

  it('validates data elements against the segment directory', () => {
    const a = analyseInterchange(
      wrap([...header, 'LOC+147+0010282', 'EQD+CN+ABCDEFGHIJKLMNOPQRS', 'MEA+AAE+VGM+KGM:12x00', 'TMP+2+-18.5:CEL', 'CNT+16']),
    );
    expect(codes(a.issues)).toEqual([
      'VALUE_TOO_LONG EQD 020.1', // C237 8260 an..17
      'MISSING_MANDATORY_COMPONENT CNT 010.2', // C270 6066 is mandatory
    ]);
    // MEA C174 6314 is an..18 in D.21B, TMP C239 6246 n..15 accepts a sign and decimal mark
    const b = analyseInterchange(wrap(['BGM+658+X+9', 'TDT+20+1', 'UNS+D', 'LOC+147+1', 'EQD+CN+A', 'TMP+2+-18.5x:CEL', 'CNT+16:1']));
    expect(codes(b.issues)).toEqual(['INVALID_NUMERIC TMP 020.1']);
  });

  it('checks UNT, UNZ counts and references', () => {
    const edi = "UNB+UNOA:3+A+B+211115:1200+REF1'UNH+1+BAPLIE:D:95B:UN'BGM++X+9'UNT+9+2'UNZ+2+REF2'";
    expect(codes(analyseInterchange(edi).issues)).toEqual([
      'MISSING_MANDATORY_SEGMENT DTM',
      'MISSING_MANDATORY_GROUP',
      'SEGMENT_COUNT_MISMATCH UNT',
      'MESSAGE_REFERENCE_MISMATCH UNT',
      'INTERCHANGE_COUNT_MISMATCH UNZ',
      'INTERCHANGE_REFERENCE_MISMATCH UNZ',
    ]);
  });

  it('rejects directories and messages that are not bundled', () => {
    expect(() => analyseInterchange("UNB+UNOA:3+A+B+211115:1200+1'UNH+1+BAPLIE:D:99Z:UN'UNT+2+1'UNZ+1+1'")).toThrow(/D99Z is not bundled/);
    expect(() => analyseInterchange("UNB+UNOA:3+A+B+211115:1200+1'UNH+1+INVOIC:D:21B:UN'UNT+2+1'UNZ+1+1'")).toThrow(/not a container message/);
    // ...unless a directory is forced
    const a = analyseInterchange("UNB+UNOA:3+A+B+211115:1200+1'UNH+1+BAPLIE:D:99Z:UN'BGM++X+9'TDT+20+1'UNS+D'UNT+5+1'UNZ+1+1'", { directory: 'D21B' });
    expect(a.messages[0].directory).toBe('D21B');
  });
});
