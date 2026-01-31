const fs = require('fs');
const path = require('path');

const DEFAULT_USER_IDS = [
  'user_36BK4zbNxwkRI0vZACrYmQoUaHA',
  'user_390IqMmASOnR3VxYRM44umCW0Rp'
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

async function updateUserRole(userId, secretKey) {
  const response = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      public_metadata: {
        role: 'company'
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Failed to update ${userId} (${response.status}): ${message}`
    );
  }

  return response.json();
}

async function main() {
  const envPath = path.join(process.cwd(), '.env.local');
  loadEnvFromFile(envPath);

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.error('Missing CLERK_SECRET_KEY in env.');
    process.exit(1);
  }

  const userIds = process.argv.slice(2);
  const targets = userIds.length > 0 ? userIds : DEFAULT_USER_IDS;

  for (const userId of targets) {
    try {
      const user = await updateUserRole(userId, secretKey);
      const role = user?.public_metadata?.role || 'unset';
      console.log(`Updated ${userId}: public_metadata.role = ${role}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
    }
  }
}

main();
