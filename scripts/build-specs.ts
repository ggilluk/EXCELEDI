/**
 * Generates the JSON specifications in `specs/` from the original UNTDID directory archives in
 * `untdid/`. Nothing is hand-written: message structures come from the segment tables of the
 * UN message specifications (EDMD/TRMD) and segment layouts from the UN segment directory
 * (EDSD/TRSD).
 *
 * Usage: tsx scripts/build-specs.ts [untdidDir] [outDir]
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeDirectoryText, expandArchive, findFile } from '../src/untdid/archive';
import { parseMessageSpecification } from '../src/untdid/message-directory';
import { parseSegmentDirectory } from '../src/untdid/segment-directory';
import { CONTAINER_MESSAGES } from '../src/spec/container-messages';
import { SERVICE_SEGMENTS } from '../src/spec/service-segments';
import type { DirectorySpec, SegmentDef, SpecIndex, StructureNode } from '../src/spec/types';

const root = resolve(__dirname, '..');
const untdidDir = resolve(process.argv[2] ?? join(root, 'untdid'));
const outDir = resolve(process.argv[3] ?? join(root, 'specs'));

function collectTags(nodes: StructureNode[], into: Set<string>): void {
  for (const n of nodes) {
    if (n.kind === 'segment') into.add(n.tag);
    else collectTags(n.children, into);
  }
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const index: SpecIndex = { generatedAt: new Date().toISOString(), directories: {} };

  const zips = readdirSync(untdidDir)
    .filter((f) => /^d\d\d[a-z]\.zip$/i.test(f))
    .sort();
  for (const zip of zips) {
    const key = zip.replace(/\.zip$/i, '').toUpperCase(); // D21B
    const suffix = key.slice(1); // 21B
    const files = expandArchive(readFileSync(join(untdidDir, zip)));

    const segFile = findFile(files, new RegExp(`^(EDSD|TRSD)\\.${suffix}$`, 'i'));
    if (!segFile) throw new Error(`${zip}: segment directory not found`);
    const segmentDir = parseSegmentDirectory(decodeDirectoryText(segFile[1]));

    const spec: DirectorySpec = { directory: key, source: `untdid/${zip}`, messages: {}, segments: {} };
    const used = new Set<string>();
    for (const type of CONTAINER_MESSAGES) {
      const f = findFile(files, new RegExp(`^${type}_D\\.${suffix}$`, 'i'));
      if (!f) continue;
      const msg = parseMessageSpecification(decodeDirectoryText(f[1]), key);
      if (msg.type !== type) throw new Error(`${f[0]}: declares message type ${msg.type}`);
      spec.messages[type] = msg;
      collectTags(msg.children, used);
    }

    for (const tag of [...used].sort()) {
      if (SERVICE_SEGMENTS[tag]) continue;
      const seg: SegmentDef | undefined = segmentDir.get(tag);
      if (!seg) throw new Error(`${key}: segment ${tag} not found in segment directory ${segFile[0]}`);
      spec.segments[tag] = seg;
    }

    const file = `${key}.json`;
    writeFileSync(join(outDir, file), JSON.stringify(spec, null, 1));
    index.directories[key] = { file, messages: Object.keys(spec.messages) };
    console.log(`${key}: ${Object.keys(spec.messages).length} messages, ${Object.keys(spec.segments).length} segments`);
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
}

main();
