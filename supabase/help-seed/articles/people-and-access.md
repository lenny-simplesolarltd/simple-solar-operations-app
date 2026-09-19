---
slug: people-and-access
title: People & access: inviting staff to the app
summary: How Admin and Manager staff check who has a login and send or resend an invite so a person can set their own password.
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
sources: ["src/app/dashboard/people/page.tsx", "src/features/people/invite-button.tsx", "src/features/people/server/invite-staff.ts", "src/components/layout/nav-visibility.ts (admin)", "src/app/auth/confirm/route.ts", "src/app/auth/sign-in/page.tsx (no-access state)"]
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

This screen does not add new people, change roles or switch off a login. There is no screen for those yet. Ask the person who manages the system.
