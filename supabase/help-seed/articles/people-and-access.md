---
slug: people-and-access
title: People & access: adding staff, roles, logins and deactivation
summary: How Admin and Manager staff add a person, give or remove roles, invite them to log in and deactivate or reactivate them.
category: administration
roles: ["Admin", "Manager"]
release_function: none
routes: ["/dashboard/people"]
tools: []
keywords: ["people", "access", "invite", "login", "new starter", "staff", "roles", "account", "resend invite"]
aliases: ["invite someone", "give someone access", "new member of staff", "new starter login", "resend invite", "invite expired", "who has a login", "add a user", "create account", "set up login", "change someones role", "remove access"]
related: ["staff-roles", "signing-in", "finding-your-way-around"]
common_task: false
sort: 10
sources: ["src/app/dashboard/people/page.tsx", "src/features/people/staff-admin.tsx", "supabase/migrations/20260920120000_convergence_operations.sql (STAFF_CREATE, STAFF_ROLE_SET, STAFF_SET_ACTIVE)", "src/features/people/invite-button.tsx", "src/features/people/server/invite-staff.ts", "src/components/layout/nav-visibility.ts (admin)", "src/app/auth/confirm/route.ts", "src/app/auth/sign-in/page.tsx (no-access state)"]
---
**People & access** lists everyone in the staff directory, their roles and whether they have a login. Only Admin and Manager staff can open it. A login is separate from being in the directory: invite only the people who need to use the app.

## What the list shows

- **Roles**: the person's active roles, or **No role**.
- **Login**: **Active login** (their login is set up), **Invited** (an invite was sent but not used yet) or **No login**.
- People marked **(inactive)** are greyed out.

## Inviting someone

1. Open **People & access** from the **Admin** menu.
2. Find the person and press **Invite**. For someone already invited, the button says **Resend invite**.
3. You see **Invite emailed to** and their address. The button changes to **Invite sent**.

The person opens the email, sets their own password and lands on **Office home**. Nobody else ever sees or chooses their password. A resent invite replaces the old one, so only the newest email works.

The **Invite** button only appears when the person is active, has an email address, has at least one role and has no login yet.

## If you can't do it

- **Give this person a role first - a login with no role has no access.**
- **This person has no email address.** or **This person is inactive.** The directory record needs correcting first.
- **A confirmed login already exists for this email.** They already have a login. They can use **Forgot your password?** on the sign-in screen.

## Adding a person

1. Press **Add person** at the top of the page.
2. Enter their **Name**, **Email** and one **Role**, then press **Add person**.
3. They appear in the list with **No login**. Press **Invite** when they need to use the app.

Someone with the same email address cannot be added twice.

## Giving or removing a role

1. Find the person and press **Give role** or **Remove role**.
2. Choose the **Role** and write a **Reason** (for example "started as office staff"), then confirm.

The change takes effect the next time they open a page. Every change records who made it and why.

## Deactivating someone

Press **Deactivate**, write a reason and confirm. They can no longer sign in or do anything in the app, straight away. Their open tasks stay where they are: move them with **Reassign** on each task. **Reactivate** gives them back the roles they still hold.

## Rules the app enforces

- Only an **Admin** can give or remove the **Admin** role.
- You cannot remove your own Admin role or deactivate yourself.
- There must always be at least one active Admin.
