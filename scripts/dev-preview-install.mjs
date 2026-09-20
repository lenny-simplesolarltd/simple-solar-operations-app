// Installs the DEV-ONLY "View as user" hook into the LOCAL Supabase stack.
// Refuses to run against anything that is not local. Re-run after `supabase db reset`.
import { execFileSync } from 'node:child_process';

// SUPABASE_TEST_WORKDIR points at another local stack (its own config.toml and
// ports), exactly as tests/helpers.mjs uses it. Without this the script asks
// the DEFAULT stack for its connection details and installs the hook into the
// wrong database - or none - while still reporting success, which makes every
// preview test fail as though the feature were broken.
const workdir = process.env.SUPABASE_TEST_WORKDIR
  ? ['--workdir', process.env.SUPABASE_TEST_WORKDIR]
  : [];
const env = Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env', ...workdir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value])
);
const dbUrl = env.DB_URL ?? '';
if (!/@(127\.0\.0\.1|localhost):\d+\//.test(dbUrl)) {
  console.error(
    'Refusing to install the preview hook: the database is not a local Supabase stack.'
  );
  process.exit(1);
}
execFileSync(
  'psql',
  [
    dbUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-q',
    '-f',
    'supabase/dev/user_preview_hook.sql'
  ],
  { stdio: 'inherit' }
);
console.log('Dev preview hook installed in the local stack.');
console.log('\nAdd to .env.local (server-only values, never NEXT_PUBLIC_*):');
console.log(`  NEXT_PUBLIC_SUPABASE_URL=${env.API_URL}`);
console.log(
  `  NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key from \`supabase status\`>`
);
console.log('  DEV_USER_PREVIEW_ENABLED=true');
console.log('  DEV_USER_PREVIEW_ALLOWED_EMAILS=<your email>');
console.log(
  '  DEV_USER_PREVIEW_JWT_SECRET=<JWT secret from `supabase status`>'
);
