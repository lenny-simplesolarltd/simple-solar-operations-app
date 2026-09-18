'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

type BreadcrumbItem = {
  title: string;
  link: string;
};

// This allows to add custom title as well
const routeMapping: Record<string, BreadcrumbItem[]> = {
  '/dashboard': [{ title: 'Office home', link: '/dashboard' }]
  // Add more custom mappings as needed
};

const SEGMENT_TITLES: Record<string, string> = {
  dashboard: 'Home',
  tasks: 'Tasks',
  jobs: 'Jobs',
  presales: 'Job sales',
  new: 'New',
  people: 'People',
  requests: 'My requests',
  booking: 'Booking',
  intake: 'Intake review',
  commissioning: 'Commissioning review',
  materials: 'Materials',
  orders: 'Merchant orders',
  'goods-in': 'Goods in',
  stock: 'Stock',
  skills: 'Installer skills',
  installs: 'My installs',
  planner: 'Planner',
  scaffold: 'Scaffold bookings',
  availability: 'Staff availability',
  system: 'System health'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const titleFor = (segment: string) =>
  SEGMENT_TITLES[segment] ??
  (UUID.test(segment)
    ? 'Details'
    : segment.charAt(0).toUpperCase() + segment.slice(1));

export function useBreadcrumbs() {
  const pathname = usePathname();

  const breadcrumbs = useMemo(() => {
    // Check if we have a custom mapping for this exact path
    if (routeMapping[pathname]) {
      return routeMapping[pathname];
    }

    // If no exact match, fall back to generating breadcrumbs from the path
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      return {
        title: titleFor(segment),
        link: path
      };
    });
  }, [pathname]);

  return breadcrumbs;
}
