// Neon Vice — make.fun gta6-01 entry program (Node standard library only).
// The playable game lives in game/ beside this file as plain static files
// (game/index.html plus its ES modules, vendored three.js, no network).
// This program stages game/ and screenshots/ into the output directory
// and writes dossier.json there via the vendored make.fun library.
//
// Local check:  MAKEFUN_OUTPUT_DIR=/tmp/nv-out node main.ts
// (Node 22+ runs .ts directly; the grader uses /output by default.)

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const dest = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameSrc = join(root, 'game');
const shotsSrc = join(root, 'screenshots');

mkdirSync(dest, { recursive: true });
cpSync(gameSrc, join(dest, 'game'), { recursive: true });
mkdirSync(join(dest, 'screenshots'), { recursive: true });
if (existsSync(shotsSrc)) {
  cpSync(shotsSrc, join(dest, 'screenshots'), { recursive: true });
}

// Caps mirror the scorer's limits: dossier text, screenshot count/size,
// and game file count, total bytes, and path length.
writeFileSync(
  join(dest, 'dossier.json'),
  buildDossier(dest, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
