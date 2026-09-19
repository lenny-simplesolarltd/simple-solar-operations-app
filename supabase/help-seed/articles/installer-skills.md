---
slug: installer-skills
title: Installer skills and teams
summary: Record what each installer is qualified for, their certification dates and which team they work in.
category: planning
roles: ["Admin", "Manager", "Director", "Office", "VariationApprover"]
release_function: none
routes: ["/dashboard/skills"]
tools: []
keywords: ["skills", "installer skills", "roof", "electrical", "certification", "apprentice", "lead", "team", "capacity", "qualified"]
aliases: ["installer skills", "add skill", "installer qualifications", "certification expiry", "certified until", "installer teams", "create team", "add installer to team", "team lead", "daily capacity", "jobs a day"]
related: ["capacity-conflicts", "planner-basics", "staff-availability", "change-installer"]
common_task: false
sort: 40
sources: ["src/app/dashboard/skills/page.tsx", "src/features/planner/components/resourcing-actions.tsx (SetSkill, UpsertTeam, SetTeamMember)", "supabase/migrations/20260919164000_r2_calendar_resourcing.sql (RP_SET_SKILL / RP_UPSERT_TEAM / RP_SET_TEAM_MEMBER: Admin/Manager/Office, no release mode; rp_assess_person skill rules)", "supabase/migrations/20260919173000_view_port_resourcing_reads.sql (INSTALLER_SKILLS)", "src/features/planner/types.ts (READINESS_REASON)"]
---
**Installer skills** shows what each installer is qualified for, their daily capacity and their teams. The Planner uses this to say who is free and able. Open it from **Installer skills** in the **Planning** menu.

## Adding or changing a skill

1. Find the installer's card.
2. Click **Add skill**, or click an existing skill such as **Roof: Lead** to change it.
3. Choose the **Skill** (Roof or Electrical) and the **Level**: Lead, Member or Apprentice.
4. Enter **Certified until** if the qualification expires.
5. Set **Active** to **No** to switch the skill off without deleting it. Add **Notes** if useful, then confirm.

Expired or inactive skills show in red, with "(expired)" next to the date.

## Teams

- Click **New team** and enter the **Name** and **Trade** (Roof, Electrical or Mixed).
- On a team card, click **Edit team** to rename it or make it inactive.
- Click **Add / change member** to add an installer, change their role, or set **In the team** to **No (remove)**. A team has one active Lead; change the current Lead first to appoint another.

## How the Planner uses this

- An installer with skills recorded, but not the one the work needs, shows **Missing this skill** on the Planner.
- **Certification expires first** and **Apprentice – needs supervision** are warnings only.
- **Change installer** on a job does not check skills.

## If you can't do it

- Only Admin, Manager and Office staff can make changes.
- "No active installers" means nobody has the Installer role yet. An administrator adds it in **People & access**.
- **No capacity set** cannot be fixed on this screen. Ask an administrator.
