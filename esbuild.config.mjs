// esbuild.config.mjs
// Two build channels from the same source:
//   - public: dist/mg-community-hub.user.js      (players — no Search tab)
//   - dev:    dist/mg-community-hub.dev.user.js  (full, including Search)
// The public build is always produced. The dev build is produced in watch
// mode, or when the local .env (gitignored) contains BUILD_DEV=1.
import esbuild from 'esbuild';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const outDir  = path.join(__dirname, 'dist');
const meta    = (await fs.readFile(path.join(__dirname, 'meta.userscript.js'), 'utf8')).trim() + '\n';
await fs.mkdir(outDir, { recursive: true });

async function readDotEnv() {
  const env = {};
  try {
    const raw = await fs.readFile(path.join(__dirname, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    /* no .env — defaults apply */
  }
  return env;
}

const dotEnv = await readDotEnv();
const buildDev = isWatch || dotEnv.BUILD_DEV === '1' || process.env.BUILD_DEV === '1';

const devMeta = meta.replace(
  /^(\/\/ @name\s+).*$/m,
  '$1MG Community Hub (DEV)',
);

function makeOptions(dev) {
  return {
    entryPoints: [path.join(__dirname, 'src', 'main.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
    legalComments: 'none',
    write: false,
    logLevel: 'info',
    define: { __HUB_DEV_BUILD__: dev ? 'true' : 'false' },
  };
}

async function buildChannel(dev) {
  const result = await esbuild.build(makeOptions(dev));
  const bundled = result.outputFiles?.[0]?.text;
  if (!bundled) throw new Error('No outputFiles from esbuild');
  const file = path.join(outDir, dev ? 'mg-community-hub.dev.user.js' : 'mg-community-hub.user.js');
  await fs.writeFile(file, (dev ? devMeta : meta) + bundled, 'utf8');
  console.log(`✅ Built (${dev ? 'dev' : 'public'}) ->`, file);
}

async function buildAll() {
  await buildChannel(false);
  if (buildDev) await buildChannel(true);
}

if (isWatch) {
  // Watch rebuilds the dev channel (the one loaded via @require file://);
  // the public channel is refreshed on each watch start and via `npm run build`.
  const ctx = await esbuild.context(makeOptions(true));
  await ctx.watch({
    onRebuild(err, result) {
      if (err) return console.error('❌ Rebuild failed:', err);
      const code = result.outputFiles?.[0]?.text ?? '';
      fs.writeFile(path.join(outDir, 'mg-community-hub.dev.user.js'), devMeta + code, 'utf8')
        .then(() => console.log('✅ Rebuilt (dev)'))
        .catch(console.error);
    },
  });
  console.log('👀 Watching… (Ctrl+C to quit)');
  await buildAll();
} else {
  await buildAll();
}
