import type { Format } from '../spec/types';

const FORMAT_RE = /^(an|a|n)(\.\.)?(\d+)$/;

/** Parses a UNTDID representation such as `an..35`, `n3` or `a1`. */
export function parseFormat(raw: string): Format {
  const m = FORMAT_RE.exec(raw.trim());
  if (!m) throw new Error(`Invalid data element representation: "${raw}"`);
  const type = m[1] as Format['type'];
  const max = Number(m[3]);
  return { type, min: m[2] ? 0 : max, max, raw: raw.trim() };
}

export const FORMAT_PATTERN = '(?:an|a|n)(?:\\.\\.)?\\d+';
