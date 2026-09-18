/**
 * Joins the truthy class names with single spaces.
 *
 * Use this for every conditional class. The repo's prettier-plugin-tailwindcss
 * rewrites string literals inside `className` and drops their leading space,
 * so `` `btn${on ? ' active' : ''}` `` is silently reformatted into
 * "btnactive". Separate arguments have no whitespace to lose.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
