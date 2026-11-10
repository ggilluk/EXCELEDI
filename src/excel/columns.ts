import type { ElementDef, SegmentDef, SegmentNode } from '../spec/types';

/**
 * Column headers identify the exact EDIFACT position a cell maps to:
 *
 * ```
 *   EQD 020.1 Equipment identifier
 *   │   │   └ component position within the composite (omitted for simple data elements)
 *   │   └──── data element position in the segment (as in the UN segment directory)
 *   └──────── segment tag
 *
 *   MEA[2] 030.2 Measure            second occurrence of a repeating segment
 *   ADR 060*2.1 Country subdivision identifier
 *                                   second repetition of a repeating data element
 *   LOC@0210[2] 020.1 ...           segment table position, only when the same tag occurs at
 *                                   several positions of the same segment group (here the 2nd
 *                                   LOC at position 0210 of D.95B BAPLIE SG2)
 * ```
 *
 * Everything after the first space following the position is a human readable label and is
 * ignored when reading.
 */
export interface ColumnRef {
  tag: string;
  /** Segment table position, when needed to disambiguate. */
  at?: string;
  /** 1-based occurrence of the segment within its group instance. */
  occurrence: number;
  /** 0-based data element index. */
  elementIndex: number;
  /** 1-based repetition of the data element. */
  repetition: number;
  /** 0-based component index (0 for simple data elements). */
  componentIndex: number;
  /** Whether a component position was written (composite data element). */
  composite: boolean;
}

const KEY_RE = /^([A-Z0-9]{3})(?:@(\d{4,5}))?(?:\[(\d+)\])?\s+(\d{3})(?:\*(\d+))?(?:\.(\d+))?(?=\s|$)/;

export function parseColumnKey(header: string): ColumnRef | undefined {
  const m = KEY_RE.exec(header.trim());
  if (!m) return undefined;
  return {
    tag: m[1],
    ...(m[2] ? { at: m[2] } : {}),
    occurrence: m[3] ? Number(m[3]) : 1,
    elementIndex: Number(m[4]) / 10 - 1,
    repetition: m[5] ? Number(m[5]) : 1,
    componentIndex: m[6] ? Number(m[6]) - 1 : 0,
    composite: Boolean(m[6]),
  };
}

export interface ColumnSpec extends ColumnRef {
  header: string;
  note: string;
  node: SegmentNode;
}

export function elementPos(index: number): string {
  return String((index + 1) * 10).padStart(3, '0');
}

/** Builds the header text for one cell position. */
export function columnHeader(
  node: SegmentNode,
  disambiguate: boolean,
  occurrence: number,
  elementIndex: number,
  repetition: number,
  componentIndex: number | undefined,
  def: SegmentDef | undefined,
  repeatable: boolean,
): { header: string; note: string } {
  const ed: ElementDef | undefined = def?.elements[elementIndex];
  const seg = `${node.tag}${disambiguate ? `@${node.pos}` : ''}${node.maxRepeat > 1 ? `[${occurrence}]` : ''}`;
  const pos = `${elementPos(elementIndex)}${repeatable ? `*${repetition}` : ''}${componentIndex !== undefined ? `.${componentIndex + 1}` : ''}`;

  let name = '(not defined in the specification)';
  let note = `${node.tag} ${node.name}\nsegment table position ${node.pos}, status ${node.status}, max ${node.maxRepeat}`;
  if (ed) {
    const comp = componentIndex !== undefined ? ed.components?.[componentIndex] : undefined;
    if (componentIndex !== undefined && ed.components) {
      if (comp) {
        name = comp.name;
        note += `\n\n${ed.id} ${ed.name} (${ed.status}${ed.repeat > 1 ? `, max ${ed.repeat}` : ''})\n${comp.id} ${comp.name}: ${comp.status} ${comp.format.raw}`;
      }
    } else if (ed.format) {
      name = ed.name;
      note += `\n\n${ed.id} ${ed.name}: ${ed.status} ${ed.format.raw}${ed.repeat > 1 ? `, max ${ed.repeat}` : ''}`;
    }
  }
  return { header: `${seg} ${pos} ${name}`, note };
}
