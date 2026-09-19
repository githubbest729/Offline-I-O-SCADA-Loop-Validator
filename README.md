# Offline I/O & SCADA Loop Validator

Offline-first PWA for field commissioning of PLC / AVEVA System Platform I/O loops.

## Quick start

```bash
npm install
npm run dev       # local dev server, LAN-exposed for phone testing
npm run build     # production build to dist/
```

Generate `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`,
and `icon-maskable-512.png` before deploying (any square PNG works for dev).

## Deploying to GitHub Pages

GitHub Pages only serves static files — it does **not** run a build step for
you. `index.html` in this repo points at `/src/main.tsx`, which only works
through Vite's dev server or after a build, so pushing the raw source to
`main` and pointing Pages at it will show a blank page.

**This repo includes `.github/workflows/deploy.yml`**, which builds the app
with Vite and publishes the `dist/` output automatically on every push to
`main`. To use it:

1. In your repo, go to **Settings → Pages → Build and deployment → Source**
   and select **GitHub Actions** (not "Deploy from a branch").
2. `vite.config.ts` sets `base: '/Offline-I-O-SCADA-Loop-Validator/'` — this
   **must exactly match your repo name** (case-sensitive), since project
   Pages sites are served from `https://<user>.github.io/<repo-name>/`, not
   the domain root. If you rename the repo, update this value too.
3. Push to `main`. The Actions tab will show the build/deploy run; the site
   updates automatically a minute or two later.

If you'd rather not use Actions and just want to commit a `dist/` folder to
`main`/root directly: run `npm run build` locally, then copy everything from
`dist/` into your repo root (or a `docs/` folder, pointing Pages at that
instead) and commit it. You'll need to repeat this manually after every
change, which is why the Actions workflow above is the better default.

## Architecture

```
public/
  manifest.json        PWA manifest
  service-worker.js     App-shell cache + Background Sync (works with tab closed)
src/
  types/index.ts         Domain types (Loop, PhotoRecord, SyncQueueItem, AppSettings)
  db/database.ts          Dexie schema + transactional mutation helpers
  utils/csvParser.ts      Header-tolerant PLC/AVEVA tag CSV importer
  utils/sync.ts            Foreground webhook sync (mirrors service-worker.js logic)
  hooks/useOnlineStatus.ts Network + sync-progress state for the UI
  components/
    ValidationCard.tsx    Full-screen loop detail: status, photos, sign-off
    CameraCapture.tsx      getUserMedia wrapper for instrumentation photos
  App.tsx                  CSV upload, live list, search/filter, status bar
  main.tsx                 SW registration + Background Sync request wiring
```

### Data-integrity guarantees

- **No unsaved state.** Every user action (status toggle, photo capture,
  sign-off) is a single Dexie transaction that writes directly to
  IndexedDB and enqueues a sync record. There is no "Save" button and no
  React state that could be lost if the tab is killed.
- **Outbox pattern.** The `syncQueue` table decouples "the data exists"
  from "the data has been sent." A crash mid-sync just leaves queue items
  in place — retried next time, never duplicated (queue entries are
  keyed per entity and only cleared on confirmed webhook success).
- **Sync works with the tab closed.** The Background Sync API fires the
  service worker even if the user has locked their phone or closed the
  browser. The worker talks to IndexedDB with the raw API (no bundler
  dependency) so it can run standalone. Browsers without Background Sync
  support (notably iOS Safari) fall back to a `postMessage`-triggered sync
  on the `online` event, handled by the same code path in the worker.

### Wiring up n8n

1. In n8n, add a **Webhook** node (POST, "Respond immediately").
2. Paste that URL into the app's Settings sheet.
3. The payload shape POSTed on each loop sync:

```json
{
  "loop": {
    "id": 42,
    "tagName": "FIC-101.PV",
    "description": "Feedwater Flow Controller",
    "signalType": "AI",
    "plcAddress": "%MW1024",
    "status": "Passed",
    "signedBy": "J. Alvarez",
    "signedAt": 1732000000000,
    "syncStatus": "pending",
    "lastModified": 1732000000000,
    "createdAt": 1731990000000,
    "version": 3
  },
  "photos": [
    { "id": 7, "filename": "FIC-101.PV_7.jpg", "mimeType": "image/jpeg", "base64": "..." }
  ],
  "device": { "userAgent": "...", "syncedAt": 1732000000000 }
}
```

4. From there, an n8n **Set** + **HTTP Request** node can reshape/forward
   this into a ClickUp task create/update call, or write straight to a
   database/Sheet.

### CSV format

Header names are matched case-insensitively with common aliases
(`Tag`, `TagName`, `Tag Name`; `Address`, `PLC Address`; etc.):

```csv
Tag Name,Description,Signal Type,PLC Address,Area
FIC-101.PV,Feedwater Flow Controller,AI,%MW1024,Unit 200
XV-204,Isolation Valve,DO,%QX2.3,Unit 200
```
