/**
 * Syntax-level model of an EDIFACT interchange (ISO 9735).
 *
 * A segment is a tag plus data elements. Every data element is stored as a list of
 * repetitions (syntax version 4 repetition separator), and every repetition as a list of
 * component values. A simple data element is therefore `[[value]]`.
 */
export interface Segment {
  tag: string;
  elements: string[][][];
}

export interface Delimiters {
  component: string;
  element: string;
  decimal: string;
  /** Release character, or `' '` when none is used. */
  release: string;
  /** Repetition separator (syntax version 4), or `' '` when none is used. */
  repetition: string;
  segment: string;
}

export interface Message {
  /** UNH ... UNT inclusive. */
  segments: Segment[];
  /** Index into `Interchange.groups` when the message is inside a functional group. */
  group?: number;
}

export interface FunctionalGroup {
  ung: Segment;
  une?: Segment;
}

export interface Interchange {
  delimiters: Delimiters;
  /** Whether the interchange started with a UNA service string advice. */
  una: boolean;
  /** Text written after each segment terminator (e.g. `\n`), detected from the input. */
  segmentSuffix: string;
  unb: Segment;
  unz?: Segment;
  groups: FunctionalGroup[];
  messages: Message[];
}

export const DEFAULT_DELIMITERS: Delimiters = {
  component: ':',
  element: '+',
  decimal: '.',
  release: '?',
  repetition: ' ',
  segment: "'",
};

/** Value of a component (1-based element and component positions, first repetition). */
export function getValue(seg: Segment, element: number, component = 1, repetition = 1): string | undefined {
  return seg.elements[element - 1]?.[repetition - 1]?.[component - 1];
}
