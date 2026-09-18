import type { NavGroup } from '@/types';

// Sidebar + Cmd-K navigation, grouped by workflow. `access` names who the
// item is offered to (see components/layout/nav-visibility.ts). This shapes the
// menu only: every page, read and command is authorised again on the server,
// so a hidden item is never the security boundary.
//
// A group or item appears here only once its screen exists.
export const navGroups: NavGroup[] = [
  {
    label: 'Home',
    items: [
      {
        title: 'Office home',
        url: '/dashboard',
        icon: 'dashboard',
        shortcut: ['d', 'd'],
        access: 'any'
      }
    ]
  },
  {
    label: 'Work',
    items: [
      {
        title: 'My tasks',
        url: '/dashboard/tasks',
        icon: 'check',
        shortcut: ['t', 't'],
        access: 'any'
      },
      {
        title: 'Team tasks',
        url: '/dashboard/tasks?scope=team',
        icon: 'teamTasks',
        shortcut: ['t', 'e'],
        access: 'teamTasks'
      },
      {
        title: 'Job search',
        url: '/dashboard/jobs',
        icon: 'search',
        shortcut: ['j', 'j'],
        access: 'jobs'
      },
      {
        title: 'My requests',
        url: '/dashboard/requests',
        icon: 'history',
        shortcut: ['r', 'r'],
        access: 'any'
      }
    ]
  },
  {
    label: 'Operations',
    items: [
      {
        title: 'Booking',
        url: '/dashboard/booking',
        icon: 'booking',
        shortcut: ['b', 'b'],
        access: 'office'
      },
      {
        title: 'Intake review',
        url: '/dashboard/intake',
        icon: 'intake',
        shortcut: ['i', 'r'],
        access: 'intakeReview'
      }
    ]
  },
  {
    label: 'Sales',
    items: [
      {
        title: 'New job sold',
        url: '/dashboard/presales/new',
        icon: 'add',
        shortcut: ['n', 'p'],
        access: 'presaleSubmit'
      },
      {
        title: 'Job sales',
        url: '/dashboard/presales',
        icon: 'page',
        shortcut: ['p', 'p'],
        access: 'jobSales'
      }
    ]
  },
  {
    label: 'Admin',
    items: [
      {
        title: 'People & access',
        url: '/dashboard/people',
        icon: 'user',
        shortcut: ['u', 'u'],
        access: 'admin'
      }
    ]
  }
];
