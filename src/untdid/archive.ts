import { unzipSync } from 'fflate';

/**
 * Recursively expands a UNTDID directory archive.
 *
 * UNECE distributes each directory as a zip of zips (e.g. `d21b.zip` contains `edmd.zip`,
 * `edsd.zip`, ...; `d95b.zip` contains `TRMD.ZIP`, `TRSD.ZIP`, ...). This returns a flat map of
 * every file found at any depth, keyed by its path (nested archive names are joined with `!/`).
 */
export function expandArchive(data: Uint8Array, prefix = ''): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const entries = unzipSync(data);
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith('/') || name.includes('__MACOSX') || /(^|\/)\._/.test(name)) continue;
    const full = prefix + name;
    if (/\.zip$/i.test(name)) {
      for (const [k, v] of expandArchive(bytes, `${full}!/`)) out.set(k, v);
    } else {
      out.set(full, bytes);
    }
  }
  return out;
}

/**
 * Decodes a UNTDID text file.
 *
 * Older directories (e.g. D.95B) are encoded in code page 437 and draw the segment-table
 * boxes with box-drawing characters. They are normalised to the ASCII glyphs used by newer
 * directories: `─` → `-`, `┐`/`┘`/`┴` → `+`, `│` → `|`. Line endings are normalised to `\n`.
 */
export function decodeDirectoryText(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    switch (b) {
      case 0xc4: // ─
        s += '-';
        break;
      case 0xbf: // ┐
      case 0xd9: // ┘
      case 0xc0: // └
      case 0xda: // ┌
      case 0xc1: // ┴ (inner group closed on the same line as an outer one)
        s += '+';
        break;
      case 0xb3: // │
        s += '|';
        break;
      default:
        s += String.fromCharCode(b);
    }
  }
  return s.replace(/\r\n?/g, '\n');
}

/** Finds the single file whose base name matches `pattern` (case-insensitive). */
export function findFile(files: Map<string, Uint8Array>, pattern: RegExp): [string, Uint8Array] | undefined {
  for (const [path, bytes] of files) {
    const base = path.split(/[/!]/).pop() ?? path;
    if (pattern.test(base)) return [path, bytes];
  }
  return undefined;
}
