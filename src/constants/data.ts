import { NavItem } from '@/types';

//Info: The following data is used for the sidebar navigation and Cmd K bar.
export const navItems: NavItem[] = [
  {
    title: 'Dashboard',
    url: '/dashboard',
    icon: 'dashboard',
    isActive: false,
    shortcut: ['d', 'd'],
    items: []
  },
  {
    title: 'New presale',
    url: '/dashboard/presales/new',
    icon: 'add',
    isActive: false,
    shortcut: ['n', 'p'],
    items: []
  },
  {
    title: 'Presales',
    url: '/dashboard/presales',
    icon: 'page',
    isActive: false,
    shortcut: ['p', 'p'],
    items: []
  },
  {
    title: 'People & access',
    url: '/dashboard/people',
    icon: 'user',
    isActive: false,
    shortcut: ['u', 'u'],
    items: []
  }
];
