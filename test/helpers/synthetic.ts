import type { Format, MessageDef, SegmentDef, StructureNode } from '../../src/spec/types';
import type { Segment } from '../../src/edifact/model';
import type { SpecRegistry } from '../../src/spec/registry';

/**
 * Builds a message containing every segment and segment group of a UN message definition,
 * with every data element and component filled with a value that conforms to its
 * representation. Repeating segments/groups occur `repeat` times (bounded by their maximum).
 */
export function syntheticMessage(def: MessageDef, registry: SpecRegistry, ref: string, repeat = 2): Segment[] {
  let counter = 0;
  const value = (f: Format): string => {
    counter++;
    const len = Math.max(f.min, Math.min(f.max, 1 + (counter % 4)));
    if (f.type === 'n') return String(counter).padStart(len, '0').slice(-len);
    if (f.type === 'a') return 'ABCDEFGHIJ'.repeat(Math.ceil(len / 10)).slice(0, len);
    // an: include characters that need the release character.
    const base = `X${counter}?+:'`.slice(0, len);
    return base.padEnd(len, 'Z');
  };
  const segment = (tag: string): Segment => {
    if (tag === 'UNH') return { tag, elements: [[[ref]], [[def.type, def.version, def.release, def.agency]]] };
    if (tag === 'UNT') return { tag, elements: [[['0']], [[ref]]] };
    const sd: SegmentDef | undefined = registry.segment(def.directory, tag);
    if (!sd) throw new Error(`no definition for ${tag}`);
    return {
      tag,
      elements: sd.elements.map((e) => {
        const reps = Math.min(e.repeat, repeat);
        return Array.from({ length: reps }, () => (e.format ? [value(e.format)] : e.components!.map((c) => value(c.format))));
      }),
    };
  };
  const out: Segment[] = [];
  const walk = (nodes: StructureNode[]) => {
    for (const n of nodes) {
      const times = Math.min(n.maxRepeat, n.kind === 'group' ? repeat : 1);
      for (let i = 0; i < times; i++) {
        if (n.kind === 'segment') out.push(segment(n.tag));
        else walk(n.children);
      }
    }
  };
  walk(def.children);
  out[out.length - 1].elements[0] = [[String(out.length)]];
  return out;
}
