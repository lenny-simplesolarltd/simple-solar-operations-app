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
      },
      {
        title: 'Operations',
        url: '/dashboard/operations',
        icon: 'activity',
        shortcut: ['o', 'p'],
        // Bulk operations are office work; the BATCHES read refuses everyone else.
        access: 'office'
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
      },
      {
        title: 'Calls',
        url: '/dashboard/tasks?scope=all&queue=calls',
        icon: 'calls',
        shortcut: ['c', 'c'],
        access: 'teamTasks'
      },
      {
        title: 'Issues',
        url: '/dashboard/issues',
        icon: 'issues',
        shortcut: ['i', 'i'],
        access: 'office'
      },
      {
        title: 'Cancellations',
        url: '/dashboard/tasks?scope=all&queue=cancellation',
        icon: 'cancellations',
        shortcut: ['x', 'x'],
        access: 'teamTasks'
      }
    ]
  },
  {
    label: 'Planning',
    items: [
      {
        title: 'Planner',
        url: '/dashboard/planner',
        icon: 'planner',
        shortcut: ['p', 'l'],
        access: 'resourcing'
      },
      {
        title: 'Scaffold bookings',
        url: '/dashboard/scaffold',
        icon: 'scaffold',
        shortcut: ['s', 'b'],
        access: 'resourcing'
      },
      {
        title: 'Staff availability',
        url: '/dashboard/availability',
        icon: 'availability',
        shortcut: ['s', 'a'],
        access: 'resourcing'
      },
      {
        title: 'Installer skills',
        url: '/dashboard/skills',
        icon: 'skills',
        shortcut: ['i', 's'],
        access: 'resourcing'
      }
    ]
  },
  {
    label: 'Installs',
    items: [
      {
        title: 'My installs',
        url: '/dashboard/installs',
        icon: 'install',
        shortcut: ['m', 'i'],
        access: 'installer'
      },
      {
        title: 'Commissioning review',
        url: '/dashboard/commissioning',
        icon: 'commissioning',
        shortcut: ['c', 'r'],
        access: 'commissioning'
      }
    ]
  },
  {
    label: 'Materials',
    items: [
      {
        title: 'Materials',
        url: '/dashboard/materials',
        icon: 'materials',
        shortcut: ['m', 'm'],
        access: 'materials'
      },
      {
        title: 'Merchant orders',
        url: '/dashboard/orders',
        icon: 'orders',
        shortcut: ['m', 'o'],
        access: 'materials'
      },
      {
        title: 'Goods in',
        url: '/dashboard/goods-in',
        icon: 'goodsIn',
        shortcut: ['g', 'i'],
        access: 'materials'
      },
      {
        title: 'Stock',
        url: '/dashboard/stock',
        icon: 'stock',
        shortcut: ['s', 's'],
        access: 'stock'
      }
    ]
  },
  {
    label: 'Forms',
    items: [
      {
        title: 'Forms',
        url: '/dashboard/forms',
        icon: 'forms',
        shortcut: ['f', 'f'],
        access: 'forms'
      }
    ]
  },
  {
    label: 'Files',
    items: [
      {
        title: 'Files & documents',
        url: '/dashboard/files',
        icon: 'files',
        shortcut: ['f', 'd'],
        access: 'files'
      }
    ]
  },
  {
    label: 'Communications',
    items: [
      {
        title: 'Email',
        url: '/dashboard/communications',
        icon: 'communications',
        shortcut: ['c', 'm'],
        access: 'communications'
      },
      {
        title: 'Team chat',
        url: '/dashboard/communications/chat',
        icon: 'chat',
        shortcut: ['c', 't'],
        access: 'chat'
      }
    ]
  },
  {
    label: 'Help',
    items: [
      {
        title: 'Help Center',
        url: '/dashboard/help',
        icon: 'help',
        shortcut: ['h', 'h'],
        access: 'any'
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
      },
      {
        title: 'Release control',
        url: '/dashboard/release',
        icon: 'release',
        shortcut: ['r', 'c'],
        access: 'releaseControl'
      },
      {
        title: 'System health',
        url: '/dashboard/system',
        icon: 'system',
        shortcut: ['s', 'h'],
        access: 'systemHealth'
      }
    ]
  }
];
