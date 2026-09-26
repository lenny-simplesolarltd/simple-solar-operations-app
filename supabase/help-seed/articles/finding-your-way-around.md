---
slug: finding-your-way-around
title: Finding your way around
summary: How the menu is organised, why you only see some menu items, and the keyboard shortcuts that save time.
category: getting-started
roles: []
release_function: none
routes: ["/dashboard"]
tools: []
keywords: ["menu", "sidebar", "navigation", "shortcuts", "keyboard", "command bar", "dark mode", "theme"]
aliases: ["where is the menu", "cant find a page", "missing menu item", "menu item missing", "why cant I see", "keyboard shortcuts", "hide sidebar", "dark mode", "light mode", "how do I get to", "where do I find"]
related: ["office-home", "searching", "staff-roles", "switched-off-features", "programmes-overview"]
common_task: false
sort: 30
sources: ["src/constants/data.ts", "src/components/layout/nav-visibility.ts", "src/components/layout/app-sidebar.tsx", "src/components/layout/header.tsx", "src/components/kbar/index.tsx", "src/components/kbar/use-theme-switching.tsx", "src/components/ui/sidebar.tsx", "supabase/migrations/20260919120000_restore_identity_and_job_sold.sql (role_permissions)", "supabase/migrations/20260919190000_forms.sql (forms permissions)"]
---
The menu on the left groups screens by the kind of work: **Home**, **Work**, **Operations**, **Planning**, **Installs**, **Materials**, **Sales**, **Forms** and **Admin**. You only see the items your roles allow, so two people can have very different menus.

## What most people see

- Everyone: **Office home**, **My tasks** and **My requests**.
- **Team tasks**: Admin, Manager, Director and Office.
- **Job search**: office roles, Surveyor and Finance.
- **Booking**, and the **Planning** group: office roles.
- **Intake review** and **Commissioning review**: Admin, Manager and Office.
- **My installs**: Installer, Office, Manager and Admin.
- **Materials**, **Merchant orders** and **Goods in**: office roles and Store. **Stock**: Admin, Manager and Store.
- **New job sold**: Surveyor, Office, Manager and Admin. **Job sales**: office roles and Surveyor.
- **People & access**: Admin and Manager. **System health**: Admin, Manager, Office and Director.
- **Forms** only appears once Forms is switched on.

"Office roles" means Admin, Manager, Director, Office and Variation Approver. See [Staff roles explained](/help/staff-roles).

## Moving around quickly

- Press **Ctrl+K** (**Cmd+K** on a Mac), or click **Search...** at the top, to open the command bar. Type part of a screen name and press Enter.
- The command bar shows a two-letter shortcut beside each screen. With nothing selected, type the two letters to jump straight there. For example **d d** opens **Office home**, **j j** opens **Job search** and **r r** opens **My requests**.
- Press **Ctrl+B** (**Cmd+B** on a Mac), or the button at the top left, to shrink or expand the menu.
- Use the brightness button at the top, or **Set Light Theme** and **Set Dark Theme** in the command bar, to change the colours.

## If you can't do it

If a screen you need is missing from your menu, your roles do not include it. Ask an administrator to check your roles on **People & access**.
