// Creates (or resets the password of) a login on the LOCAL Supabase stack so you
// can sign in during development. It links to the seeded person with the same
// email. Refuses to run against anything that is not local.
//
//   node scripts/dev-create-login.mjs lenny@simplesolarltd.co.uk 'a-long-password'
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('usage: node scripts/dev-create-login.mjs <email> <password>');
  process.exit(1);
}

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
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.API_URL ?? '')) {
  console.error('Refusing to run: the Supabase stack is not local.');
  process.exit(1);
}

const supabase = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { data: list, error: listError } = await supabase.auth.admin.listUsers();
if (listError) throw listError;
const existing = list.users.find((u) => u.email === email.toLowerCase());

const { error } = existing
  ? await supabase.auth.admin.updateUserById(existing.id, { password })
  : await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    });
if (error) throw error;

const { data: person, error: personError } = await supabase
  .from('people')
  .select(
    'display_name, person_roles!person_roles_person_id_fkey(role_code, active)'
  )
  .eq('email', email.toLowerCase())
  .maybeSingle();
if (personError) throw personError;

console.log(
  person
    ? `Login ready for ${person.display_name} [${person.person_roles
        .filter((r) => r.active)
        .map((r) => r.role_code)
        .join(', ')}]`
    : `Login created, but no person has the email ${email} - it will have no access.`
);
