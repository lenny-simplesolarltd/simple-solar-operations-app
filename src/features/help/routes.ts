// The staff screens that exist, as route patterns (folder names under
// src/app). Articles name the screens they help with using these patterns, so:
//  - contextual help can map the page someone is on to its articles, and
//  - Help health can flag an article that names a screen that no longer exists.
// A unit test (__tests__/routes.test.ts) fails when this list and the actual
// pages drift apart. Safe to import from client components.

export const APP_ROUTES = [
  '/dashboard',
  '/dashboard/availability',
  '/dashboard/booking',
  '/dashboard/commissioning',
  '/dashboard/commissioning/[workPackageId]',
  '/dashboard/communications',
  '/dashboard/communications/[communicationId]',
  '/dashboard/communications/chat',
  '/dashboard/communications/compose',
  '/dashboard/files',
  '/dashboard/forms',
  '/dashboard/forms/[id]',
  '/dashboard/forms/[id]/preview',
  '/dashboard/forms/responses/[id]',
  '/dashboard/goods-in',
  '/dashboard/goods-in/[deliveryId]',
  '/dashboard/help',
  '/dashboard/help/[slug]',
  '/dashboard/help/category/[category]',
  '/dashboard/help/manage',
  '/dashboard/help/manage/[id]',
  '/dashboard/help/manage/new',
  '/dashboard/installs',
  '/dashboard/installs/[workPackageId]',
  '/dashboard/intake',
  '/dashboard/issues',
  '/dashboard/jobs',
  '/dashboard/jobs/[jobId]',
  '/dashboard/jobs/[jobId]/booking',
  '/dashboard/jobs/[jobId]/move',
  '/dashboard/materials',
  '/dashboard/materials/[jobId]',
  '/dashboard/operations',
  '/dashboard/orders',
  '/dashboard/orders/[orderId]',
  '/dashboard/people',
  '/dashboard/planner',
  '/dashboard/presales',
  '/dashboard/presales/new',
  '/dashboard/release',
  '/dashboard/requests',
  '/dashboard/scaffold',
  '/dashboard/scaffold/[bookingId]',
  '/dashboard/skills',
  '/dashboard/stock',
  '/dashboard/system',
  '/dashboard/tasks',
  '/dashboard/tasks/[taskId]'
] as const;

export type AppRoute = (typeof APP_ROUTES)[number];

const STATIC_FIRST = [...APP_ROUTES].sort(
  (a, b) =>
    (a.match(/\[/g)?.length ?? 0) - (b.match(/\[/g)?.length ?? 0) ||
    b.length - a.length
);

/** The route pattern for a concrete path ("/dashboard/jobs/abc/move" -> "/dashboard/jobs/[jobId]/move"). */
export function routePatternFor(pathname: string): AppRoute | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const parts = path.split('/');
  for (const route of STATIC_FIRST) {
    const pattern = route.split('/');
    if (pattern.length !== parts.length) continue;
    if (
      pattern.every(
        (seg, i) =>
          (seg.startsWith('[') && seg.endsWith(']') && parts[i] !== '') ||
          seg === parts[i]
      )
    ) {
      return route;
    }
  }
  return null;
}

export const isAppRoute = (route: string): route is AppRoute =>
  (APP_ROUTES as readonly string[]).includes(route);

/** Screens where a "Help with this page" link is not useful (the Help Center itself). */
export const isHelpRoute = (route: string) =>
  route === '/dashboard/help' || route.startsWith('/dashboard/help/');
