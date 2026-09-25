// Runs the synthetic programme scale fixture against the LOCAL Supabase stack.
//
// The wrapper exists for one reason: to make it impossible to point this at a
// hosted database by accident. It reads the connection string from `supabase
// status`, refuses anything whose host is not loopback, and only then sets the
// session flag the SQL insists on.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workdir = process.env.SUPABASE_TEST_WORKDIR
  ? ['--workdir', process.env.SUPABASE_TEST_WORKDIR]
  : [];
const status = execFileSync('supabase', ['status', '-o', 'env', ...workdir], {
  encoding: 'utf8'
});
const url = status.match(/^DB_URL="?(.*?)"?$/m)?.[1];
if (!url) throw new Error('could not read DB_URL from `supabase status`');

const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error(
    `refusing to run: ${host} is not a local database. This fixture is synthetic ` +
      'development data and must never reach a hosted project.'
  );
}

// `--undo` removes it again. The fixture is switched on for scale and browser
// work and switched off before the integration suite, which counts rows.
const undo = process.argv.includes('--undo');
const sql = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  undo ? 'scale-fixture-undo.sql' : 'scale-fixture.sql'
);
// The flag travels as a connection option, so the SQL file cannot be run
// without it even if somebody pipes the file into psql by hand.
execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', sql], {
  stdio: 'inherit',
  env: { ...process.env, PGOPTIONS: '-c app.scale_fixture=yes' }
});
