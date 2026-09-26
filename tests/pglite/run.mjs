// Docker-free database tests: replays every migration in supabase/migrations on
// an in-memory Postgres (PGlite, with small stand-ins for Supabase's auth schema
// and roles) and runs each suite t_*.mjs in its own process.
//
//   npm run test:db:pglite            all suites
//   npm run test:db:pglite -- t_s15   one suite (name prefix)
//
// These complement `npm run test:db` (the real local Supabase stack): PGlite has
// no PostgREST, Storage or pg_cron, so those paths are skipped or guarded.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const only = process.argv.slice(2);
const suites = fs
  .readdirSync(here)
  .filter((f) => /^t_.+\.mjs$/.test(f))
  .filter((f) => only.length === 0 || only.some((o) => f.startsWith(o)))
  .sort();

let failed = 0;
for (const suite of suites) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [suite], {
    cwd: here,
    env: { ...process.env, PORT_ALL: '1' },
    encoding: 'utf8'
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.status === 0) {
    console.log(`ok     ${suite} (${secs}s)`);
  } else {
    failed += 1;
    console.log(`FAIL   ${suite} (${secs}s)`);
    console.log(
      (r.stdout + r.stderr)
        .split('\n')
        .filter((l) => !/^\s+at /.test(l))
        .slice(-25)
        .join('\n')
    );
  }
}
console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
