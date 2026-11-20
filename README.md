# Namma Ward: ward-wise civic outreach PWA

A lightweight progressive web app built from the *Karisandra Civic Outreach & Election
Readiness Plan* (slides 7, 8 and 13). The first ward is Karisandra (old BBMP Ward 166,
Padmanabhanagar AC 171). Add any ward by editing one JSON file.

## What it does

Resident app (`/`), English and Kannada, installable on Android and iPhone, works offline:

| Screen | Plan reference |
|---|---|
| Report an Issue: category, micro-zone, map pin or GPS, photo, opt-in contact | Slide 9, core feature 1 |
| Track My Complaint: ticket number, status timeline, before and after photos | Core feature 2 |
| Issue Map: complaints by status, locations rounded to ~100 m | Core feature 3 (heatmap) |
| Verified Work Tracker: work order, agency, amount, status, evidence, source | Core feature 4, slide 12 |
| Public Services: one-tap call to helplines | Core feature 5 |
| Ward Updates and Upcoming Meetings | Slide 8 |
| Ward Report: totals, acknowledgement rate, median hours to action, median days to resolve, by category and agency | Slides 7 and 14 (KPIs) |

Status pipeline follows slide 7: **New → Submitted → In Progress → Resolved → Pending (with reason)**.

Ward team console (`/admin.html`): update status, agency and agency reference, add a
public timeline note and an "after" photo, post updates, meetings and verified works,
export complaints as CSV.

Offline: complaints made with no signal are saved on the phone (IndexedDB) and sent
automatically when the phone is back online. Re-sends never create duplicate tickets.

## Privacy rules built in (slide 8)

- The form never asks for political preference, caste, religion, income or voting history.
- Name and mobile are stored only if the resident ticks consent, and are never returned by
  any public API. Only the ward team console sees them.
- Public map and tracker show locations rounded to about 100 m.
- Volunteer street-audit entries are tagged `volunteer` so audit coverage can be measured.

## Run it

Needs Node.js 18 or newer. No packages to install.

```powershell
cd namma-ward-pwa
$env:ADMIN_KEY = "choose-a-long-secret"; node server.js
```

Open http://localhost:8080 for residents and http://localhost:8080/admin.html for the
ward team. Without `ADMIN_KEY` the key is `change-me` (development only).

## Add a ward

Copy the `sample-ward` block in `data/wards.json` and set `id`, a 3-letter `code` (used
in ticket numbers such as `KRS-00001`), names in `en` and `kn`, map `center`, micro-zones
and service numbers. Restart the server. Residents can open a ward directly with
`/?ward=<id>` (useful for QR codes on posters and civic-service cards).

Check the helpline numbers in `data/wards.json` against current official sources before
launch, and confirm ward boundaries against the final State Election Commission notification.

## Project layout

```
server.js               API + static server (Node built-ins only)
data/wards.json         wards, micro-zones, categories, agencies, helplines
data/db.json            complaints and posts (created on first run)
data/uploads/           photos (resized on the phone before upload)
public/index.html       resident app shell
public/js/app.js        screens and router
public/js/api.js        API calls, offline outbox, photo resize
public/js/i18n.js       English and Kannada text
public/js/admin.js      ward team console
public/sw.js            service worker (offline shell, cached ward data and map tiles)
public/manifest.webmanifest, public/icons/
```

## API

| Method | Path | Who |
|---|---|---|
| GET | `/api/config` | public |
| GET / POST | `/api/wards/:ward/issues` | public (POST rate-limited) |
| GET | `/api/issues/:ticket` | public (no contact details) |
| PATCH | `/api/issues/:ticket` | admin |
| GET | `/api/wards/:ward/stats` | public |
| GET / POST | `/api/wards/:ward/updates`, `meetings`, `projects` | GET public, POST admin |
| GET | `/api/wards/:ward/admin-issues`, `export.csv` | admin |

Admin calls send the header `x-admin-key`.

## Before going live

1. Serve over HTTPS (required for install, GPS and camera on phones). Any Node host works:
   a VPS behind Nginx or Caddy, Render, Railway, or Hostinger Node.js hosting.
2. Set a strong `ADMIN_KEY`; for more than a few team members, replace it with per-person
   logins and roles.
3. The JSON file store suits one pilot ward. For several wards move to PostgreSQL (with
   PostGIS for the heatmap) and put photos in object storage.
4. Back up `data/` daily.
5. Publish a correction policy and only post updates and works that have a source.
6. Next steps from the plan: SMS or WhatsApp status alerts (opt-in only), Telugu and Tamil
   text, and a native Android build after usage is proven.
