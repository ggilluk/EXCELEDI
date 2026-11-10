import { DEFAULT_DELIMITERS, type Delimiters, type Interchange, type Message, type Segment } from './model';

export class EdifactSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset?: number,
  ) {
    super(offset === undefined ? message : `${message} (at character ${offset})`);
    this.name = 'EdifactSyntaxError';
  }
}

/** Syntax identifiers whose character repertoire is not covered by ISO 8859-1. */
const UTF8_SYNTAX = new Set(['UNOW', 'UNOX', 'UNOY']);

/** Decodes raw bytes according to the syntax identifier found in UNB (S001 0001). */
export function decodeInterchange(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.subarray(0, 64)).toString('latin1');
  const m = /UNB.(UNO[A-Z])/.exec(head);
  const enc = m && UTF8_SYNTAX.has(m[1]) ? 'utf8' : 'latin1';
  let text = Buffer.from(bytes).toString(enc);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

export function encodeInterchange(text: string, syntaxIdentifier: string | undefined): Buffer {
  return Buffer.from(text, syntaxIdentifier && UTF8_SYNTAX.has(syntaxIdentifier) ? 'utf8' : 'latin1');
}

/**
 * Splits EDIFACT text into segments.
 *
 * Handles the UNA service string advice, the release character and the syntax version 4
 * repetition separator (implicitly `*` when there is no UNA and UNB declares syntax version 4).
 * Line breaks between (or inside) segments are ignored unless a line break is itself a
 * delimiter.
 */
export function tokenize(input: string): { delimiters: Delimiters; una: boolean; segmentSuffix: string; segments: Segment[] } {
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let pos = 0;
  while (pos < text.length && /\s/.test(text[pos])) pos++;

  let delimiters: Delimiters = { ...DEFAULT_DELIMITERS };
  let una = false;
  if (text.startsWith('UNA', pos)) {
    if (text.length < pos + 9) throw new EdifactSyntaxError('Truncated UNA service string advice', pos);
    const s = text.slice(pos + 3, pos + 9);
    delimiters = {
      component: s[0],
      element: s[1],
      decimal: s[2],
      release: s[3],
      repetition: s[4],
      segment: s[5],
    };
    una = true;
    pos += 9;
  }
  const ignoreLineBreaks = ![delimiters.component, delimiters.element, delimiters.segment].some((d) => d === '\n' || d === '\r');

  const segments: Segment[] = [];
  let segmentSuffix: string | undefined;
  text = text.slice(pos);
  const offsetBase = pos;
  let i = 0;

  while (i < text.length) {
    // Skip whitespace between segments.
    while (i < text.length && (text[i] === '\r' || text[i] === '\n' || (text[i] === ' ' && ignoreLineBreaks) || text[i] === '\t')) i++;
    if (i >= text.length) break;
    const segStart = i;
    const elements: string[][][] = [];
    let element: string[][] = [];
    let repetition: string[] = [];
    let value = '';
    let terminated = false;
    const rel = delimiters.release !== ' ' ? delimiters.release : undefined;
    const rep = delimiters.repetition !== ' ' ? delimiters.repetition : undefined;

    for (; i < text.length; i++) {
      const ch = text[i];
      if (rel && ch === rel) {
        i++;
        if (i >= text.length) throw new EdifactSyntaxError('Release character at end of input', offsetBase + i);
        value += text[i];
        continue;
      }
      if (ignoreLineBreaks && (ch === '\r' || ch === '\n')) continue;
      if (ch === delimiters.component) {
        repetition.push(value);
        value = '';
      } else if (rep && ch === rep && elements.length > 0) {
        repetition.push(value);
        element.push(repetition);
        repetition = [];
        value = '';
      } else if (ch === delimiters.element) {
        repetition.push(value);
        element.push(repetition);
        elements.push(element);
        element = [];
        repetition = [];
        value = '';
      } else if (ch === delimiters.segment) {
        repetition.push(value);
        element.push(repetition);
        elements.push(element);
        terminated = true;
        i++;
        break;
      } else {
        value += ch;
      }
    }
    if (!terminated) {
      throw new EdifactSyntaxError(`Segment not terminated by "${delimiters.segment}"`, offsetBase + segStart);
    }

    const [tagElement, ...data] = elements;
    const tag = tagElement[0][0];
    if (!/^[A-Z0-9]{3}$/.test(tag)) {
      throw new EdifactSyntaxError(`Invalid segment tag "${tag}"`, offsetBase + segStart);
    }
    segments.push({ tag, elements: trimSegment(data) });

    if (segmentSuffix === undefined) {
      const m = /^(\r\n|\n|\r)/.exec(text.slice(i));
      segmentSuffix = m ? m[1] : '';
    }

    // Without UNA, syntax version 4 implies the default repetition separator "*".
    if (tag === 'UNB' && !una && segments.length === 1 && data[0]?.[0]?.[1] === '4') {
      delimiters = { ...delimiters, repetition: '*' };
    }
  }

  return { delimiters, una, segmentSuffix: segmentSuffix ?? '', segments };
}

/** Removes trailing empty components / repetitions / elements (they carry no data). */
export function trimSegment(elements: string[][][]): string[][][] {
  const out = elements.map((el) => {
    const reps = el.map((r) => {
      const c = [...r];
      while (c.length > 1 && c[c.length - 1] === '') c.pop();
      return c;
    });
    while (reps.length > 1 && reps[reps.length - 1].every((v) => v === '')) reps.pop();
    return reps;
  });
  while (out.length > 0 && out[out.length - 1].every((r) => r.every((v) => v === ''))) out.pop();
  return out;
}

export function isEmptyElement(el: string[][] | undefined): boolean {
  return !el || el.every((r) => r.every((v) => v === ''));
}

/** Parses an EDIFACT interchange (UNA? UNB (UNG? UNH ... UNT UNE?)* UNZ). */
export function parseInterchange(input: string | Uint8Array): Interchange {
  const text = typeof input === 'string' ? input : decodeInterchange(input);
  const { delimiters, una, segmentSuffix, segments } = tokenize(text);
  if (segments[0]?.tag !== 'UNB') {
    throw new EdifactSyntaxError(`Interchange must start with UNB, found ${segments[0]?.tag ?? 'nothing'}`);
  }

  const ic: Interchange = { delimiters, una, segmentSuffix, unb: segments[0], groups: [], messages: [] };
  let current: Message | undefined;
  let group: number | undefined;

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (current) {
      current.segments.push(seg);
      if (seg.tag === 'UNT') current = undefined;
      else if (seg.tag === 'UNH' || seg.tag === 'UNZ') {
        throw new EdifactSyntaxError(`Message ${current.segments[0].elements[0]?.[0]?.[0] ?? ''} has no UNT`);
      }
      continue;
    }
    switch (seg.tag) {
      case 'UNH':
        current = { segments: [seg] };
        if (group !== undefined) current.group = group;
        ic.messages.push(current);
        break;
      case 'UNG':
        if (group !== undefined) throw new EdifactSyntaxError('UNG inside a functional group without UNE');
        ic.groups.push({ ung: seg });
        group = ic.groups.length - 1;
        break;
      case 'UNE':
        if (group === undefined) throw new EdifactSyntaxError('UNE without UNG');
        ic.groups[group].une = seg;
        group = undefined;
        break;
      case 'UNZ':
        if (i !== segments.length - 1) throw new EdifactSyntaxError('Segments found after UNZ');
        ic.unz = seg;
        break;
      default:
        throw new EdifactSyntaxError(`Unexpected segment ${seg.tag} outside of a message`);
    }
  }
  if (current) throw new EdifactSyntaxError('Last message has no UNT');
  return ic;
}

function escapeValue(value: string, d: Delimiters): string {
  const special = [d.component, d.element, d.segment, d.release];
  if (d.repetition !== ' ') special.push(d.repetition);
  let out = '';
  for (const ch of value) {
    if (special.includes(ch) && ch !== ' ') {
      if (d.release === ' ') throw new Error(`Value "${value}" contains delimiter "${ch}" but no release character is defined`);
      out += d.release;
    }
    out += ch;
  }
  return out;
}

export function serializeSegment(seg: Segment, d: Delimiters): string {
  const elements = trimSegment(seg.elements);
  const rep = d.repetition !== ' ' ? d.repetition : undefined;
  const parts = elements.map((el) => {
    if (el.length > 1 && !rep) throw new Error(`Segment ${seg.tag}: repeated data element but no repetition separator`);
    return el.map((r) => r.map((v) => escapeValue(v, d)).join(d.component)).join(rep ?? '');
  });
  return [seg.tag, ...parts].join(d.element) + d.segment;
}

export interface SerializeOptions {
  /** Write the UNA service string advice. Defaults to `interchange.una`. */
  una?: boolean;
  /** Text after each segment terminator. Defaults to `interchange.segmentSuffix`. */
  segmentSuffix?: string;
}

export function serializeInterchange(ic: Interchange, options: SerializeOptions = {}): string {
  const d = ic.delimiters;
  const suffix = options.segmentSuffix ?? ic.segmentSuffix;
  const out: string[] = [];
  if (options.una ?? ic.una) {
    out.push(`UNA${d.component}${d.element}${d.decimal}${d.release}${d.repetition}${d.segment}`);
  }
  out.push(serializeSegment(ic.unb, d) + suffix);
  let openGroup: number | undefined;
  const closeGroup = () => {
    if (openGroup !== undefined) {
      const une = ic.groups[openGroup].une;
      if (une) out.push(serializeSegment(une, d) + suffix);
      openGroup = undefined;
    }
  };
  for (const msg of ic.messages) {
    if (msg.group !== openGroup) {
      closeGroup();
      if (msg.group !== undefined) {
        out.push(serializeSegment(ic.groups[msg.group].ung, d) + suffix);
        openGroup = msg.group;
      }
    }
    for (const seg of msg.segments) out.push(serializeSegment(seg, d) + suffix);
  }
  closeGroup();
  if (ic.unz) out.push(serializeSegment(ic.unz, d) + suffix);
  // The UNA string is directly followed by UNB in ISO 9735; keep the line layout of the input.
  return out[0].startsWith('UNA') ? out[0] + suffix + out.slice(1).join('') : out.join('');
}
