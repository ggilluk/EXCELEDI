/**
 * Builds the self-contained demo page `site/index.html`: the transformer, ExcelJS, the
 * generated UN/EDIFACT specifications and the sample interchanges are bundled into one HTML
 * file that runs entirely in the browser (no server, no network requests).
 *
 * Usage: tsx scripts/build-web.ts   (run `npm run build:specs` first)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, type Plugin } from 'esbuild';

const root = resolve(__dirname, '..');
const specDir = join(root, 'specs');
const fixtures = join(root, 'test', 'fixtures');
const outDir = join(root, 'site');

const virtual: Plugin = {
  name: 'virtual',
  setup(b) {
    b.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'virtual' }));
    b.onResolve({ filter: /^node:(fs|path)$/ }, (a) => ({ path: a.path, namespace: 'node-shim' }));
    b.onLoad({ filter: /.*/, namespace: 'node-shim' }, () => ({
      // The browser build always passes the embedded specifications to SpecRegistry.
      contents:
        'const no = () => { throw new Error("not available in the browser"); };' +
        'export const existsSync = () => false, readFileSync = no, join = (...p) => p.join("/"), dirname = (p) => p;',
      loader: 'js',
    }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, (a) => {
      if (a.path === 'virtual:specs') {
        const index = JSON.parse(readFileSync(join(specDir, 'index.json'), 'utf8'));
        const directories = Object.values<{ file: string }>(index.directories).map((d) =>
          JSON.parse(readFileSync(join(specDir, d.file), 'utf8')),
        );
        return { contents: JSON.stringify({ index, directories }), loader: 'json' };
      }
      if (a.path === 'virtual:samples') {
        const samples = readdirSync(fixtures)
          .filter((f) => f.endsWith('.edi'))
          .sort()
          .map((f) => ({ name: f, text: readFileSync(join(fixtures, f), 'latin1') }));
        return { contents: JSON.stringify(samples), loader: 'json' };
      }
      return undefined;
    });
  },
};

async function main(): Promise<void> {
  const result = await build({
    entryPoints: [join(root, 'web', 'main.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    minify: true,
    write: false,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    plugins: [virtual],
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = readFileSync(join(root, 'web', 'style.css'), 'utf8');
  const html = readFileSync(join(root, 'web', 'index.html'), 'utf8')
    .replace('/*STYLE*/', () => css)
    .replace('/*SCRIPT*/', () => js);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);
  writeFileSync(join(outDir, '.nojekyll'), '');
  console.log(`site/index.html: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
