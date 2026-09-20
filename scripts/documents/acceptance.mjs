// Runner for the acceptance script.
//
// `worker.ts` is marked 'server-only', which is exactly right for application
// code - it makes importing it from a client component a build error. This
// harness is neither, so it aliases that guard to an empty module rather than
// removing it from the module it protects.
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  alias: { 'server-only': new URL('./noop.mjs', import.meta.url).pathname }
});

await jiti.import('./acceptance.ts');
