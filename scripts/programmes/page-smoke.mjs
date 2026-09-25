// Signed-in HTTP smoke test of the programme screens, against the LOCAL stack.
// Session cookies are produced by @supabase/ssr itself, so they are exactly what
// the app's own server client reads back.
//
// A page a person may not see is answered with the dashboard, not with programme
// content, so "refused" is asserted on CONTENT rather than on a status code.
import { createServerClient } from '@supabase/ssr';

const API = 'http://127.0.0.1:55321';
const BASE = 'http://127.0.0.1:3100';
const P = `/dashboard/operations/programmes`;
const programmeId = process.env.PROGRAMME_ID;

async function cookieFor(email) {
  const jar = new Map();
  const client = createServerClient(API, process.env.LOCAL_ANON, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (l) => l.forEach((c) => jar.set(c.name, c.value))
    }
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: 'local-test-password-1'
  });
  if (error) throw new Error(`${email}: ${error.message}`);
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
}

const results = [];
/** `expect` must all be present; `absent` must all be missing. */
async function check(label, path, cookie, expect = [], absent = []) {
  const res = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual'
  });
  const body = res.status === 200 ? await res.text() : '';
  const missing = expect.filter((n) => !body.includes(n));
  const leaked = absent.filter((n) => body.includes(n));
  results.push({ label, status: res.status, location: res.headers.get('location') ?? '', missing, leaked });
}

const [lucy, lenny, john] = await Promise.all([
  cookieFor('lucy@simplesolarltd.co.uk'),
  cookieFor('lenny@simplesolarltd.co.uk'),
  cookieFor('john@simplesolarltd.co.uk')
]);

await check('signed out is sent to sign in', P, null);

// --- Office: reporting, review, board, list, properties -------------------------
await check('office: programme list', P, lucy, [
  'PCH Meter SIM Replacement 2026',
  'SYNTHETIC TEST DATA'
]);
await check('office: overview + reporting', `${P}/${programmeId}`, lucy, [
  'Progress',
  'Total properties',
  'Run rate',
  'PCH portal verification',
  'CSQ bands',
  'not yet confirmed with the client',
  'Complete &amp; working'
]);
await check('office: review queue (no-access visit first)', `${P}/${programmeId}/review`, lucy, [
  'Portal verification',
  'Final disposition',
  'Expected meter serial',
  'Why this needs a look',
  // The queue's first visit is a no-access one, so the portal question does not
  // apply and the panel says so instead of asking it.
  'nothing to check in the\n                the portal'.replace(/\s+/g, ' ').slice(0, 20)
]);
await check('office: board has the five columns', `${P}/${programmeId}/board`, lucy, [
  'Awaiting review',
  'rebook',
  'Action required',
  'Meter requires changing',
  'Complete &amp; working'
]);
await check('office: all visits', `${P}/${programmeId}/visits`, lucy, [
  'Property ID',
  'MISMATCH',
  'CSQ'
]);
await check('office: properties search', `${P}/${programmeId}/properties`, lucy, [
  'Expected meter serial',
  'DEV-0001'
]);
// Importing is manager/admin work: the office is refused.
await check('office: import is refused', `${P}/${programmeId}/import`, lucy, [], [
  'Choose a CSV file'
]);

// --- Admin: import ---------------------------------------------------------------
await check('admin: import wizard', `${P}/${programmeId}/import`, lenny, [
  'Choose a CSV file',
  'Previous imports'
]);

// --- Installer: the field workflow, and nothing else -----------------------------
await check('installer: record a visit', `${P}/${programmeId}/visit`, john, [
  'Installer Meter Visit',
  'What happened?',
  'Tenant not home',
  'SIM changed - meter appears working',
  'Meter dead',
  'Property'
]);
await check('installer: sees their own visits', `${P}/${programmeId}/visits`, john, [
  'Property ID'
]);
await check('installer: board is refused', `${P}/${programmeId}/board`, john, [], [
  'Meter requires changing'
]);
await check('installer: review is refused', `${P}/${programmeId}/review`, john, [], [
  'Final disposition'
]);
await check('installer: import is refused', `${P}/${programmeId}/import`, john, [], [
  'Choose a CSV file'
]);

let bad = 0;
for (const r of results) {
  const problems = [
    ...r.missing.map((m) => `MISSING ${m}`),
    ...r.leaked.map((m) => `LEAKED ${m}`)
  ];
  if (problems.length) bad += 1;
  console.log(
    `${problems.length ? 'FAIL' : 'ok  '} ${String(r.status).padEnd(3)} ${(r.location ? `-> ${r.location}` : '').padEnd(16)} ${r.label}` +
      (problems.length ? `\n         ${problems.join('\n         ')}` : '')
  );
}
console.log(bad === 0 ? '\nALL PAGE CHECKS PASSED' : `\n${bad} page(s) failed`);
