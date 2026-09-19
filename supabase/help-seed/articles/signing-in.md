---
slug: signing-in
title: Signing in, setting and resetting your password
summary: How to sign in with your work email, set your password from your invite email, and reset a forgotten password.
category: getting-started
roles: []
release_function: none
routes: []
tools: []
keywords: ["sign in", "log in", "login", "password", "invite", "reset", "account", "sign out", "google"]
aliases: ["cant log in", "can't sign in", "forgot password", "reset password", "change password", "set my password", "invite email", "link expired", "locked out", "no access", "how do I log in", "log out", "sign out", "keep me signed in"]
related: ["office-home", "people-and-access", "finding-your-way-around"]
common_task: true
sort: 10
sources: ["src/app/auth/actions.ts", "src/app/auth/auth-forms.tsx", "src/app/auth/sign-in/page.tsx", "src/app/auth/forgot-password/page.tsx", "src/app/auth/update-password/page.tsx", "src/app/auth/complete/page.tsx", "src/app/auth/confirm/route.ts", "src/app/auth/callback/route.ts", "src/components/layout/user-nav.tsx", "src/lib/auth-providers.ts"]
---
Only staff can use the system. Nobody signs up: an administrator invites you, and you choose your own password.

## Setting your password for the first time

1. Open the invite email and click the link.
2. On **Set your password**, type a **New password** of at least 10 characters, and type it again in **Confirm password**.
3. Press **Set password**. You go straight to **Office home**.

## Signing in

1. Enter your work **Email** and **Password**.
2. Tick **Keep me signed in** on your own device. Leave it unticked on a shared computer: you are then signed out when the browser closes.
3. Press **Sign in**.

If **Continue with Google** is shown, you can use your work Google account instead. It only works for a Google account with the same email as your staff record.

## Forgot your password

1. On the sign-in screen, press **Forgot your password?**
2. Enter your **Work email** and press **Email me a reset link**.
3. Open the email, click the link and set a new password.

For privacy, the screen says a link is on its way whether or not the address has an account.

To change your password while signed in, click your avatar at the top right and choose **Change password**. **Sign out** is in the same menu.

## If you can't do it

- **Incorrect email or password.** Check for typing mistakes, or reset your password.
- **That link has expired or was already used.** Invite and reset links work once. Reset your password, or ask an administrator to send a new invite.
- **Too many sign-in attempts.** Wait a minute and try again.
- **No access** or **This account has been suspended.** Your staff record has no role or has been switched off. Ask an administrator.
