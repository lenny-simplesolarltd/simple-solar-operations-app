import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../../..');
const SRC = path.join(ROOT, 'src');
const FEATURE = path.join(SRC, 'features/assistant');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const isTest = (file: string) => file.includes('__tests__');
const sources = [
  ...walk(FEATURE),
  ...walk(path.join(SRC, 'app/api/assistant'))
].filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
const read = (file: string) => readFileSync(file, 'utf8');
const rel = (file: string) => path.relative(ROOT, file);

describe('assistant code boundaries', () => {
  it('never touches the service-role client', () => {
    for (const file of sources) {
      const text = read(file);
      expect(text, rel(file)).not.toMatch(
        /supabase\/admin|createAdminClient|SERVICE_ROLE/
      );
    }
  });

  it('never reads a secret from a NEXT_PUBLIC_ variable', () => {
    for (const file of sources) {
      const text = read(file);
      expect(text, rel(file)).not.toMatch(
        /NEXT_PUBLIC_[A-Z_]*(ANTHROPIC|GEMINI|GEMENI|ASSISTANT|API_KEY|SECRET)/
      );
    }
  });

  it('marks every server module server-only, so a client import is a build error', () => {
    const server = sources.filter((f) =>
      f.includes(`${path.sep}server${path.sep}`)
    );
    expect(server.length).toBeGreaterThan(8);
    for (const file of server) {
      expect(read(file), rel(file)).toMatch(/^import 'server-only';/);
    }
  });

  it('keeps provider SDKs and env secrets out of client and shared modules', () => {
    const clientSide = sources.filter(
      (f) =>
        !f.includes(`${path.sep}server${path.sep}`) &&
        !f.includes(`${path.sep}api${path.sep}`)
    );
    expect(clientSide.length).toBeGreaterThan(8);
    for (const file of clientSide) {
      const text = read(file);
      expect(text, rel(file)).not.toMatch(
        /@anthropic-ai\/sdk|process\.env|node:crypto/
      );
      // Types may cross the boundary; runtime imports of server code may not.
      const runtimeServerImport =
        /^import (?!type\b)[^;]*from '[^']*\/server\/[^']*';/m;
      expect(text, rel(file)).not.toMatch(runtimeServerImport);
    }
  });

  it('only the Anthropic adapter imports the Anthropic SDK', () => {
    const importers = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f))
      .filter((f) => read(f).includes('@anthropic-ai/sdk'))
      .map(rel);
    expect(importers).toEqual([
      'src/features/assistant/server/providers/anthropic.ts'
    ]);
  });
});

describe('production client bundle', () => {
  const staticDir = path.join(ROOT, '.next/static');

  // Runs against the output of `npm run build`; skipped when there is no build.
  it.skipIf(!existsSync(staticDir))(
    'contains no server secrets or provider code',
    () => {
      const markers = [
        'ANTHROPIC_API_KEY',
        'ASSISTANT_ACTION_SECRET',
        'SUPABASE_SERVICE_ROLE_KEY',
        'api.anthropic.com',
        'GEMINI_API_KEY',
        'GEMENI_API_KEY',
        'generativelanguage.googleapis.com',
        'retrieved-data-not-instructions'
      ];
      const secrets = [
        process.env.ANTHROPIC_API_KEY,
        process.env.GEMINI_API_KEY,
        process.env.GEMENI_API_KEY,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      ].filter((v): v is string => !!v && v.length > 12);
      for (const file of walk(staticDir).filter((f) => f.endsWith('.js'))) {
        const text = read(file);
        for (const marker of [...markers, ...secrets]) {
          expect(
            text.includes(marker),
            `${rel(file)} contains ${marker.slice(0, 24)}`
          ).toBe(false);
        }
      }
    }
  );
});
