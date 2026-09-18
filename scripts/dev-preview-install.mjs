// Installs the DEV-ONLY "View as user" hook into the LOCAL Supabase stack.
// Refuses to run against anything that is not local. Re-run after `supabase db reset`.
import { execFileSync } from 'node:child_process';

const env = Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env'], {
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
