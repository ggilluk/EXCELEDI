import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeDirectoryText, expandArchive, findFile } from '../src/untdid/archive';
import { parseMessageSpecification } from '../src/untdid/message-directory';
import { parseSegmentDirectory } from '../src/untdid/segment-directory';
import { getDefaultRegistry } from '../src/spec/registry';
import type { StructureNode } from '../src/spec/types';

/** Compact signature of a structure: TAG[min..max], groups as SGn[min..max]{...}. */
const sig = (nodes: StructureNode[]): string =>
  nodes
    .map((n) =>
      n.kind === 'group'
        ? `${n.id}[${n.status}${n.maxRepeat}]{${sig(n.children)}}`
        : `${n.tag}[${n.status}${n.maxRepeat}]`,
    )
    .join(' ');

const registry = getDefaultRegistry();

describe('UNTDID directory parsing', () => {
  it('reads the official D.21B BAPLIE segment table (UNTDID D.21B, TBG3, revision 8)', () => {
    const files = expandArchive(readFileSync(join(__dirname, '..', 'untdid', 'd21b.zip')));
    const [, bytes] = findFile(files, /^BAPLIE_D\.21B$/)!;
    const def = parseMessageSpecification(decodeDirectoryText(bytes), 'D21B');
    expect(def).toMatchObject({ type: 'BAPLIE', version: 'D', release: '21B', agency: 'UN', revision: '8', date: '2021-11-15' });
    expect(def.name).toBe('Bayplan/stowage plan occupied and empty locations message');
    // Section 4.1: "Segment group 6: LOC-ATT-FTX-RFF-SG7-CNT",
    // "Segment group 7: EQD-NAD-MEA-HAN-ATT-DIM-RFF-GDS-FTX-SG8-SG9-SG10-SG11".
    expect(sig(def.children)).toBe(
      'UNH[M1] BGM[M1] DTM[C9] SG1[C9]{RFF[M1] DTM[C9]} SG2[C9]{NAD[M1] SG3[C9]{CTA[M1] COM[C9]}} ' +
        'SG4[M9]{TDT[M1] RFF[C9] FTX[C9] SG5[C9]{LOC[M1] DTM[C9]}} UNS[M1] ' +
        'SG6[C99999]{LOC[M1] ATT[C99] FTX[C9] RFF[C9] SG7[C9]{EQD[M1] NAD[C9] MEA[C9] HAN[C99] ATT[C99] DIM[C9] RFF[C9] GDS[C99] FTX[C9] ' +
        'SG8[C9]{LOC[M1] TSR[C1] TDT[C1]} SG9[C9]{TMP[M1] RNG[C1] DTM[C1]} SG10[C9]{EQA[M1] NAD[C1]} ' +
        'SG11[C999]{DGS[M1] ATT[C9] MEA[C9] FTX[C9] SG12[C9]{CTA[M1] COM[C9]}}} CNT[M1]} UNT[M1]',
    );
  });

  it('reads code page 437 box drawings of older directories (D.95B BAPLIE)', () => {
    expect(sig(registry.message('D95B', 'BAPLIE').children)).toBe(
      'UNH[M1] BGM[M1] DTM[M1] RFF[C1] NAD[C3] SG1[M3]{TDT[M1] LOC[M2] DTM[M99] RFF[C1] FTX[C1]} ' +
        'SG2[C9999]{LOC[M1] GID[C1] GDS[C1] FTX[C9] MEA[M9] DIM[C9] TMP[C1] RNG[C1] LOC[C9] RFF[M1] ' +
        'SG3[C3]{EQD[M1] EQA[C9] NAD[C1]} SG4[C999]{DGS[M1] FTX[C1]}} UNT[M1]',
    );
  });

  it('handles change indicators placed between position and tag (D.00B CODECO)', () => {
    const codeco = registry.message('D00B', 'CODECO');
    // "0260 +     ----- Segment group 7" and "0270 * TMP Temperature"
    const sg6 = codeco.children.find((c) => c.kind === 'group' && c.id === 'SG6');
    expect(sig([sg6!])).toBe(
      'SG6[C999]{GID[M1] HAN[C9] FTX[C9] PIA[C9] MEA[C9] SG7[C9]{TMP[M1] RNG[C1]} SGP[C999] SG8[C99]{DGS[M1] FTX[C9] MEA[C9] SG9[C9]{CTA[M1] COM[C9]}}}',
    );
  });

  it('parses segment specifications with composites and syntax 4 repetitions', () => {
    const eqd = registry.segment('D21B', 'EQD')!;
    expect(eqd.name).toBe('Equipment details');
    expect(eqd.function).toBe('To identify a unit of equipment.');
    expect(eqd.elements.map((e) => `${e.pos} ${e.id} ${e.status}`)).toEqual([
      '010 8053 M', '020 C237 C', '030 C224 C', '040 8077 C', '050 8249 C', '060 8169 C', '070 4233 C',
    ]);
    expect(eqd.elements[1].components!.map((c) => `${c.id} ${c.format.raw}`)).toEqual([
      '8260 an..17', '1131 an..17', '3055 an..3', '3207 an..3',
    ]);
    const com = registry.segment('D21B', 'COM')!;
    expect(com.elements[0]).toMatchObject({ id: 'C076', repeat: 3 });
    // D.95B segment directory (TRSD) has no repetition column
    expect(registry.segment('D95B', 'EQD')!.elements[0]).toMatchObject({ id: '8053', repeat: 1, format: { raw: 'an..3' } });
  });

  it('parses a segment directory excerpt', () => {
    const text = [
      '----------------------------------------------------------------------',
      '',
      '       TMP  TEMPERATURE',
      '',
      '       Function: To specify the temperature setting.',
      '',
      '010    6245 TEMPERATURE TYPE CODE QUALIFIER            M    1 an..3',
      '',
      '020    C239 TEMPERATURE SETTING                        C    1',
      '       6246  Temperature degree                        C      n..15',
      '       6411  Measurement unit code                     C      an..8',
      '',
      '----------------------------------------------------------------------',
    ].join('\n');
    const tmp = parseSegmentDirectory(text).get('TMP')!;
    expect(tmp.elements[1].components![0].format).toEqual({ type: 'n', min: 0, max: 15, raw: 'n..15' });
  });

  it('bundles the container messages of every directory', () => {
    expect(registry.directories()).toEqual(['D00B', 'D13B', 'D16A', 'D21B', 'D95B']);
    expect(registry.messageTypes('D21B')).toEqual([
      'BAPLIE', 'CALINF', 'COARRI', 'CODECO', 'CODENO', 'COEDOR', 'COHAOR', 'COPARN', 'COPINO',
      'COPRAR', 'COREOR', 'COSTCO', 'COSTOR', 'DESTIM', 'MOVINS', 'TPFREP', 'VERMAS', 'VESDEP',
    ]);
    expect(registry.messageTypes('D95B')).not.toContain('VERMAS');
  });
});
