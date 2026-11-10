import type { ComponentDef, ElementDef, SegmentDef, Status } from '../spec/types';
import { FORMAT_PATTERN, parseFormat } from './format';

/**
 * Parser for UNTDID segment directories (`EDSD.yyx` in current directories, `TRSD.yyx` in
 * directories up to D.96x). Each segment specification lists its data elements; composite
 * data elements are followed by their component data elements, e.g.
 *
 * ```
 *        EQD  EQUIPMENT DETAILS
 *
 *        Function: To identify a unit of equipment.
 *
 * 010    8053 EQUIPMENT TYPE CODE QUALIFIER              M    1 an..3
 *
 * 020    C237 EQUIPMENT IDENTIFICATION                   C    1
 *        8260  Equipment identifier                      C      an..17
 * ```
 */

/**
 * Change indicators (`+ * # | X -`, see section "Change indicators") may appear in the left
 * margin or, in some directories, between the position and the tag (`010 X  C529 ...`).
 */
const CI = '(?:[+*#|X-]{1,3}\\s*)?';
const CI_MID = '(?:[+*#|X]\\s+)?';

const SEGMENT_HEADER_RE = new RegExp(`^\\s*${CI}\\s+([A-Z][A-Z0-9]{2})\\s{2,}([A-Z][^a-z]*)$`);
const ELEMENT_RE = new RegExp(
  `^\\s*${CI}(\\d{3})\\s+${CI_MID}([A-Z]\\d{3}|\\d{4})\\s+(.+?)\\s+([MC])(?:\\s+(\\d+))?(?:\\s+(${FORMAT_PATTERN}))?\\s*$`,
);
const ELEMENT_START_RE = new RegExp(`^\\s*${CI}\\d{3}\\s+${CI_MID}([A-Z]\\d{3}|\\d{4})\\s`);
const COMPONENT_RE = new RegExp(`^\\s*${CI}(\\d{4})\\s+(.+?)\\s+([MC])\\s+(${FORMAT_PATTERN})\\s*$`);
const COMPONENT_START_RE = new RegExp(`^\\s*${CI}\\d{4}\\s+[A-Za-z]`);
const SEPARATOR_RE = /^-{20,}\s*$/;

export function parseSegmentDirectory(text: string): Map<string, SegmentDef> {
  const segments = new Map<string, SegmentDef>();
  const blocks: string[][] = [[]];
  for (const line of text.split('\n')) {
    if (SEPARATOR_RE.test(line)) blocks.push([]);
    else blocks[blocks.length - 1].push(line);
  }

  for (const block of blocks) {
    const seg = parseBlock(block);
    if (seg) segments.set(seg.tag, seg);
  }
  return segments;
}

function parseBlock(lines: string[]): SegmentDef | undefined {
  let i = 0;
  let header: RegExpExecArray | null = null;
  for (; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    header = SEGMENT_HEADER_RE.exec(lines[i].trimEnd());
    // A segment header is always followed by its "Function:" text.
    if (header && lines.slice(i + 1, i + 4).some((l) => /^\s*[+*#|X-]{0,3}\s*Function:/.test(l))) break;
    header = null;
  }
  if (!header) return undefined;

  const seg: SegmentDef = { tag: header[1], name: titleCase(header[2].trim()), elements: [] };
  i++;

  // Function text: from "Function:" up to the first blank line.
  const fn: string[] = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    const m = /^\s*[+*#|X-]{0,3}\s*Function:\s*(.*)$/.exec(l);
    if (m) {
      fn.push(m[1].trim());
      for (i++; i < lines.length && lines[i].trim(); i++) fn.push(lines[i].trim());
      break;
    }
  }
  if (fn.length) seg.function = fn.join(' ');

  let current: ElementDef | undefined;
  for (; i < lines.length; i++) {
    let line = lines[i].trimEnd();
    if (!line.trim()) continue;

    if (ELEMENT_START_RE.test(line)) {
      let m = ELEMENT_RE.exec(line);
      // Long names may wrap onto the following line.
      if (!m && i + 1 < lines.length) {
        const joined = `${line} ${lines[i + 1].trim()}`;
        m = ELEMENT_RE.exec(joined);
        if (m) i++;
      }
      if (!m) throw new Error(`Segment ${seg.tag}: cannot parse element line "${line}"`);
      const [, pos, id, name, status, repeat, fmt] = m;
      current = {
        pos,
        id,
        name: titleCase(name),
        status: status as Status,
        repeat: repeat ? Number(repeat) : 1,
      };
      if (fmt) current.format = parseFormat(fmt);
      else current.components = [];
      seg.elements.push(current);
      continue;
    }

    if (COMPONENT_START_RE.test(line)) {
      let m = COMPONENT_RE.exec(line);
      if (!m && i + 1 < lines.length) {
        line = `${line} ${lines[i + 1].trim()}`;
        m = COMPONENT_RE.exec(line);
        if (m) i++;
      }
      if (!m) throw new Error(`Segment ${seg.tag}: cannot parse component line "${lines[i]}"`);
      if (!current?.components) throw new Error(`Segment ${seg.tag}: component outside composite: "${line}"`);
      const comp: ComponentDef = {
        id: m[1],
        name: m[2].trim().replace(/\s+/g, ' '),
        status: m[3] as Status,
        format: parseFormat(m[4]),
      };
      current.components.push(comp);
      continue;
    }

    // Notes and other text after the element list are ignored.
    if (/^\s*Note/i.test(line)) break;
  }

  for (const el of seg.elements) {
    if (el.components && el.components.length === 0) {
      throw new Error(`Segment ${seg.tag}: composite ${el.id} has no components`);
    }
  }
  return seg;
}

/** Directory names are upper case in segment specifications; present them in sentence case. */
export function titleCase(name: string): string {
  const s = name.trim().replace(/\s+/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
