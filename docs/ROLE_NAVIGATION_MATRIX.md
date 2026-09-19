# Role navigation matrix

The sidebar is built from `src/constants/data.ts` (items with an `access`
key) and `src/components/layout/nav-visibility.ts` (who each key is for).
Menus only shape what is offered; every page, read and command is
authorised again on the server (`FINAL_ROUTE_ACCEPTANCE.md` shows the server
refusing direct URLs).

## Groups and items

| Group | Item | URL | Access key |
|---|---|---|---|
| Home | Office home | `/dashboard` | any |
| Work | My tasks | `/dashboard/tasks` | any |
| | Team tasks | `/dashboard/tasks?scope=team` | teamTasks |
| | Job search | `/dashboard/jobs` | jobs |
| | My requests | `/dashboard/requests` | any |
| Sales | New job sold | `/dashboard/presales/new` | presaleSubmit |
| | Job sales | `/dashboard/presales` | jobSales |
| Operations | Booking | `/dashboard/booking` | office |
| | Intake review | `/dashboard/intake` | intakeReview |
| | Calls | `/dashboard/tasks?scope=all&queue=calls` | teamTasks |
| | Issues | `/dashboard/issues` | office |
| | Cancellations | `/dashboard/tasks?scope=all&queue=cancellation` | teamTasks |
| Planning | Planner, Scaffold bookings, Staff availability, Installer skills | ... | resourcing |
| Installs | My installs | `/dashboard/installs` | installer |
| | Commissioning review | `/dashboard/commissioning` | commissioning |
| Materials | Materials, Merchant orders, Goods in | ... | materials |
| | Stock | `/dashboard/stock` | stock |
| Forms | Forms | `/dashboard/forms` | forms (only when FN-21 is on) |
| Files | Files & documents | `/dashboard/files` | files |
| Help | Help Center | `/dashboard/help` | any |
| Admin | People & access | `/dashboard/people` | admin |
| | Release control | `/dashboard/release` | releaseControl |
| | System health | `/dashboard/system` | systemHealth |

SimpleBot is in the top bar for everyone signed in; what it can do follows
the person's own permissions.

## Access keys

| Key | Who |
|---|---|
| any | every signed-in person |
| office, resourcing | Admin, Manager, Director, Office, VariationApprover |
| officeManager, intakeReview, commissioning | Admin, Manager, Office |
| teamTasks | permission `task.read.all`, or Admin / Manager / Office |
| jobs | office roles + Surveyor + Finance |
| jobSales | permission `job.read.all` / `job.read.own`, or office roles |
| presaleSubmit | permission `presale.submit` |
| materials | office roles + Store |
| stock | Admin, Manager, Store |
| installer | Installer, Office, Manager, Admin |
| files | every role that can read some file (office roles, Surveyor, Finance, Store, Installer; not ReadOnly / Scaffolder) |
| forms | FN-21 on + permission `forms.read` |
| admin | Admin, Manager |
| releaseControl | Admin, Manager (act); Director (reads) |
| systemHealth | Admin, Manager, Office, Director |

## What each role sees (observed in the browser, production build)

| Role | Sidebar |
|---|---|
| Admin | Office home, My tasks, Team tasks, Job search, My requests, New job sold, Job sales, Booking, Intake review, Calls, Issues, Cancellations, Planner, Scaffold bookings, Staff availability, Installer skills, My installs, Commissioning review, Materials, Merchant orders, Goods in, Stock, Files & documents, Help Center, People & access, Release control, System health |
| Manager | same as Admin |
| Director | Office home, My tasks, Team tasks, Job search, My requests, Job sales, Booking, Calls, Issues, Cancellations, Planner, Scaffold bookings, Staff availability, Installer skills, Materials, Merchant orders, Goods in, Files & documents, Help Center, Release control (read only), System health |
| Office | Office home, My tasks, Team tasks, Job search, My requests, New job sold, Job sales, Booking, Intake review, Calls, Issues, Cancellations, Planner, Scaffold bookings, Staff availability, Installer skills, My installs, Commissioning review, Materials, Merchant orders, Goods in, Files & documents, Help Center, System health |
| VariationApprover | same as Office |
| Surveyor | Office home, My tasks, Job search, My requests, New job sold, Job sales, Files & documents, Help Center |
| Installer | Office home, My tasks, My requests, My installs, Files & documents, Help Center |
| Store | Office home, My tasks, My requests, Materials, Merchant orders, Goods in, Stock, Files & documents, Help Center |

Notes:
- Director has no New job sold (Director does not sell on behalf of
  surveyors; business decision 2026-09-18) and no People & access (Admin /
  Manager only), and cannot switch release functions.
- Surveyors see only their own job sales and those jobs' Overview, Tasks and
  Files tabs; a job sold by another surveyor is not found.
- Installers reach jobs through their allocated work (My installs, R3,
  release-gated) and the photos / certificates of that work in Files.
- Store is a role in the model but no genuine staff member holds it yet
  (the acceptance used a synthetic local-only Store login).
