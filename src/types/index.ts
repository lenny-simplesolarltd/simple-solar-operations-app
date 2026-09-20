import { Icons } from '@/components/icons';

export interface NavItem {
  title: string;
  url: string;
  disabled?: boolean;
  external?: boolean;
  shortcut?: [string, string];
  icon?: keyof typeof Icons;
  label?: string;
  description?: string;
  isActive?: boolean;
  items?: NavItem[];
}

/** Who a navigation entry is offered to (evaluated on the server). */
export type NavAccess =
  | 'any'
  | 'office'
  | 'officeManager'
  | 'systemHealth'
  | 'releaseControl'
  | 'files'
  | 'teamTasks'
  | 'jobs'
  | 'jobSales'
  | 'presaleSubmit'
  | 'admin'
  | 'intakeReview'
  | 'materials'
  | 'stock'
  | 'installer'
  | 'commissioning'
  | 'resourcing'
  | 'communications'
  | 'forms';

export interface NavEntry {
  title: string;
  url: string;
  icon: keyof typeof Icons;
  shortcut?: [string, string];
  access: NavAccess;
}

export interface NavGroup {
  label: string;
  items: NavEntry[];
}

/** The menu a signed-in person actually gets (serializable; built on the server). */
export interface VisibleNavGroup {
  label: string;
  items: Omit<NavEntry, 'access'>[];
}

export interface NavItemWithChildren extends NavItem {
  items: NavItemWithChildren[];
}

export interface NavItemWithOptionalChildren extends NavItem {
  items?: NavItemWithChildren[];
}

export interface FooterItem {
  title: string;
  items: {
    title: string;
    href: string;
    external?: boolean;
  }[];
}

export type MainNavItem = NavItemWithOptionalChildren;

export type SidebarNavItem = NavItemWithChildren;
