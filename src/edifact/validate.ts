import type { Format, SegmentDef } from '../spec/types';
import type { Issue } from './issues';
import { isEmptyElement } from './syntax';
import type { Segment } from './model';

/**
 * Validates the data elements of a segment against its segment directory definition:
 * presence of mandatory elements/components, number of elements, components and repetitions,
 * and the representation (a / n / an, length) of every value.
 */
export function validateSegment(def: SegmentDef, seg: Segment, base: Partial<Issue> = {}): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Issue['severity'], code: string, message: string, element?: string) =>
    issues.push({ ...base, severity, code, message, tag: seg.tag, ...(element ? { element } : {}) });

  if (seg.elements.length > def.elements.length) {
    add('error', 'TOO_MANY_ELEMENTS', `${seg.tag} has ${seg.elements.length} data elements, the specification defines ${def.elements.length}`);
  }

  def.elements.forEach((ed, i) => {
    const el = seg.elements[i];
    if (isEmptyElement(el)) {
      if (ed.status === 'M') add('error', 'MISSING_MANDATORY_ELEMENT', `Mandatory data element ${ed.id} ${ed.name} is missing`, ed.pos);
      return;
    }
    if (el.length > ed.repeat) {
      add('error', 'TOO_MANY_REPETITIONS', `Data element ${ed.id} occurs ${el.length} times, at most ${ed.repeat} allowed`, ed.pos);
    }
    el.forEach((rep, r) => {
      const where = ed.repeat > 1 ? `${ed.pos}*${r + 1}` : ed.pos;
      if (ed.format) {
        if (rep.length > 1) add('error', 'COMPONENTS_IN_SIMPLE_ELEMENT', `Simple data element ${ed.id} must not have components`, where);
        checkValue(rep[0], ed.format, `${ed.id} ${ed.name}`, where, add);
        return;
      }
      const comps = ed.components ?? [];
      if (rep.every((v) => v === '')) {
        if (ed.status === 'M') add('error', 'MISSING_MANDATORY_ELEMENT', `Mandatory composite ${ed.id} ${ed.name} is missing`, where);
        return;
      }
      if (rep.length > comps.length) {
        add('error', 'TOO_MANY_COMPONENTS', `Composite ${ed.id} has ${rep.length} components, the specification defines ${comps.length}`, where);
      }
      comps.forEach((cd, c) => {
        const v = rep[c] ?? '';
        const cw = `${where}.${c + 1}`;
        if (v === '') {
          if (cd.status === 'M') add('error', 'MISSING_MANDATORY_COMPONENT', `Mandatory component ${cd.id} ${cd.name} of ${ed.id} is missing`, cw);
          return;
        }
        checkValue(v, cd.format, `${cd.id} ${cd.name}`, cw, add);
      });
    });
  });
  return issues;
}

function checkValue(
  value: string,
  format: Format,
  label: string,
  where: string,
  add: (severity: Issue['severity'], code: string, message: string, element?: string) => void,
): void {
  if (value === '') return;
  let length = value.length;
  if (format.type === 'n') {
    // ISO 9735: sign and decimal mark are not counted in the length of numeric values.
    if (!/^-?(\d+([.,]\d*)?|[.,]\d+)$/.test(value)) {
      add('error', 'INVALID_NUMERIC', `${label}: "${value}" is not numeric (${format.raw})`, where);
      return;
    }
    length = value.replace(/[-.,]/g, '').length;
  } else if (format.type === 'a' && /\d/.test(value)) {
    add('warning', 'INVALID_ALPHABETIC', `${label}: "${value}" contains digits but is alphabetic (${format.raw})`, where);
  }
  if (length > format.max) {
    add('error', 'VALUE_TOO_LONG', `${label}: "${value}" is ${length} characters, maximum ${format.max} (${format.raw})`, where);
  } else if (length < format.min) {
    add('error', 'VALUE_TOO_SHORT', `${label}: "${value}" is ${length} characters, required ${format.min} (${format.raw})`, where);
  }
}
