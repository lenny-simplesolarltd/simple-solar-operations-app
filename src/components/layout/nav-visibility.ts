import type { AppUser } from '@/lib/auth';
import { isAdmin } from '@/lib/roles';
import type { NavItem } from '@/types';

// Shapes the menu only. Each page (and RLS behind it) remains the enforcement
// point; this just avoids offering links that would bounce the user.
const ADMIN_ONLY_URLS = new Set(['/dashboard/people']);

export function visibleNavItems(items: NavItem[], user: AppUser): NavItem[] {
  return items.filter(
    (item) => !ADMIN_ONLY_URLS.has(item.url) || isAdmin(user)
  );
}
