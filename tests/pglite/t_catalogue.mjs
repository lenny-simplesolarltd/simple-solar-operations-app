import assert from 'node:assert/strict';
import { fresh } from './harness.mjs';
const db = await fresh();
const d = async (c, id = null) =>
  (await db.query(`select public.describe_command_error($1, $2) r`, [c, id]))
    .rows[0].r;
assert.equal(
  (await d('MAT_REVIEW: order has no lines')).status,
  'ActionRequired'
);
assert.equal((await d('SCF_REFUSED: x', 'cmd-1')).status, 'Failed');
assert.equal((await d('STOCK_CONFIG: no store')).status, 'Failed');
assert.equal(
  (await d('R1C_ASSIGNMENT_DENIED')).message,
  "You're not allocated to this work package."
);
assert.equal(
  (await d('R1C_EXPECTED_VERSION_REQUIRED')).status,
  'ActionRequired'
);
assert.equal((await d('R1A_STALE_VERSION')).status, 'ActionRequired');
assert.equal(
  (await d('S15_REVIEW: normal work suppressed')).status,
  'ActionRequired'
);
console.log(
  'catalogue OK',
  (await d('MAT_REVIEW: order has no lines')).message
);
