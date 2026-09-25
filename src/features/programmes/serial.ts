/**
 * Comparing a typed meter serial with the one the client expects.
 *
 * This is an ADVISORY aid for the installer's screen and nothing else. The
 * server derives `meter_serial_matches` in programme_visit_submit, from the
 * property's stored `expected_serial_norm`, and the office reviews every
 * mismatch. What is here exists only so that someone still standing at the meter
 * is told that what they have typed does not look like the expected serial -
 * the one moment when checking the meter again costs nothing.
 *
 * The normalisation mirrors app.programme_norm_serial character for character
 * (upper case, every non-alphanumeric character removed, empty means none). If
 * the two ever disagreed, the screen would tell a field worker one thing and the
 * office record would say another.
 */

export function normaliseSerial(
  value: string | null | undefined
): string | null {
  const stripped = (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return stripped === '' ? null : stripped;
}

export type SerialComparison =
  /** No expected serial was imported, so there is nothing to compare against. */
  | 'no-expected'
  /** Nothing typed yet. */
  | 'not-typed'
  | 'match'
  | 'mismatch';

export function compareSerials(
  expected: string | null | undefined,
  actual: string | null | undefined
): SerialComparison {
  const want = normaliseSerial(expected);
  const got = normaliseSerial(actual);
  if (!want) return 'no-expected';
  if (!got) return 'not-typed';
  return want === got ? 'match' : 'mismatch';
}
