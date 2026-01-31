const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_CLIENTS = [
  {
    id: 'user_390LBVpgkESGuMftYlBfnr2DXTl',
    name: 'Kyro Blazerebel',
    email: 'kyro.blazerebel11@gmail.com',
    subscription_plan: 'basic'
  }
];

function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  raw.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const sanitized = trimmed.startsWith('export ')
      ? trimmed.slice(7).trim()
      : trimmed;
    const eqIndex = sanitized.indexOf('=');
    if (eqIndex === -1) return;
    const key = sanitized.slice(0, eqIndex).trim();
    let value = sanitized.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  });
}

async function upsertClient(supabase, client) {
  const payload = {
    id: client.id,
    name: client.name,
    email: client.email ?? null,
    subscription_plan: client.subscription_plan || 'basic'
  };

  const attempt = async (data) =>
    supabase
      .from('clients')
      .upsert(data, { onConflict: 'id' })
      .select('id, name')
      .single();

  let { data, error } = await attempt(payload);

  if (error && typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    const fallback = { ...payload };
    let shouldRetry = false;

    if (message.includes('email') && message.includes('column')) {
      delete fallback.email;
      shouldRetry = true;
    }

    if (message.includes('subscription_plan') && message.includes('column')) {
      delete fallback.subscription_plan;
      shouldRetry = true;
    }

    if (shouldRetry) {
      ({ data, error } = await attempt(fallback));
    }
  }

  if (error) {
    throw new Error(
      `Failed to upsert client ${client.id}: ${error.message || error}`
    );
  }

  return data;
}

async function main() {
  const envPath = path.join(process.cwd(), '.env.local');
  loadEnvFromFile(envPath);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.'
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const targets =
    args.length >= 1
      ? [
          {
            id: args[0],
            name: args[1] || args[0],
            email: args[2] || null,
            subscription_plan: args[3] || 'basic'
          }
        ]
      : DEFAULT_CLIENTS;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  for (const client of targets) {
    try {
      const saved = await upsertClient(supabase, client);
      console.log(
        `Upserted client ${saved.id}: ${saved.name} (${saved.subscription_plan})`
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  }
}

main();
