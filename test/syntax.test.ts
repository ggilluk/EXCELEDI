import { describe, expect, it } from 'vitest';
import { parseInterchange, serializeInterchange, serializeSegment, tokenize, EdifactSyntaxError } from '../src/edifact/syntax';
import { DEFAULT_DELIMITERS } from '../src/edifact/model';

describe('EDIFACT syntax (ISO 9735)', () => {
  it('reads UNA delimiters and the release character', () => {
    const t = tokenize("UNA|*,# ~UNB*UNOA|3*A*B*211115|1200*1~FTX*AAA***A#*B#|C#~D#~E##~");
    expect(t.delimiters).toEqual({ component: '|', element: '*', decimal: ',', release: '#', repetition: ' ', segment: '~' });
    expect(t.segments[1]).toEqual({ tag: 'FTX', elements: [[['AAA']], [['']], [['']], [['A*B|C~D~E#']]] });
  });

  it('uses the default delimiters without UNA and "*" repetition for syntax version 4', () => {
    const v3 = tokenize("UNB+UNOA:3+A+B+211115:1200+1'COM+X*Y:EM'");
    expect(v3.delimiters.repetition).toBe(' ');
    expect(v3.segments[1].elements[0]).toEqual([['X*Y', 'EM']]);
    const v4 = tokenize("UNB+UNOC:4+A+B+20211115:1200+1'COM+X:EM*Y:TE'");
    expect(v4.delimiters.repetition).toBe('*');
    expect(v4.segments[1].elements[0]).toEqual([['X', 'EM'], ['Y', 'TE']]);
  });

  it('ignores line breaks and remembers the segment suffix', () => {
    const t = tokenize("UNA:+.? '\r\nUNB+UNOA:3+A+B+211115:1200+1'\r\nUNZ+0+1'\r\n");
    expect(t.segmentSuffix).toBe('\r\n');
    expect(t.segments.map((s) => s.tag)).toEqual(['UNB', 'UNZ']);
  });

  it('drops trailing empty data elements and components', () => {
    const t = tokenize("UNB+UNOA:3+A+B+211115:1200+1'EQD+CN+ABCU1234560::+45G1++'");
    expect(t.segments[1].elements).toEqual([[['CN']], [['ABCU1234560']], [['45G1']]]);
  });

  it('escapes delimiters on output', () => {
    expect(serializeSegment({ tag: 'FTX', elements: [[['AAA']], [['']], [['']], [["IT'S 50+ ?:)"]]] }, DEFAULT_DELIMITERS)).toBe(
      "FTX+AAA+++IT?'S 50?+ ???:)'",
    );
    expect(() =>
      serializeSegment({ tag: 'COM', elements: [[['a', 'EM'], ['b', 'TE']]] }, DEFAULT_DELIMITERS),
    ).toThrow(/repetition separator/);
  });

  it('groups messages into functional groups', () => {
    const ic = parseInterchange(
      "UNB+UNOA:3+A+B+211115:1200+1'UNG+CODECO+A+B+211115:1200+G1+UN+D:95B'UNH+1+CODECO:D:95B:UN'BGM++1'UNT+3+1'UNE+1+G1'UNZ+1+1'",
    );
    expect(ic.groups).toHaveLength(1);
    expect(ic.messages[0].group).toBe(0);
    expect(serializeInterchange(ic)).toBe(
      "UNB+UNOA:3+A+B+211115:1200+1'UNG+CODECO+A+B+211115:1200+G1+UN+D:95B'UNH+1+CODECO:D:95B:UN'BGM++1'UNT+3+1'UNE+1+G1'UNZ+1+1'",
    );
  });

  it('reports syntax errors', () => {
    expect(() => parseInterchange("UNH+1+BAPLIE:D:95B:UN'")).toThrow(/must start with UNB/);
    expect(() => parseInterchange("UNB+UNOA:3+A+B+211115:1200+1'UNH+1+X:D:95B:UN'BGM'")).toThrow(/no UNT/);
    expect(() => tokenize("UNB+UNOA:3+A+B+211115:1200+1'BGM+1")).toThrow(EdifactSyntaxError);
  });
});
