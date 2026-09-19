/**
 * service-worker.js
 * ----------------------------------------------------------------------
 * Two jobs, kept strictly separate:
 *
 *  1) APP SHELL CACHING — cache-first for everything the SPA needs to boot
 *     (HTML/CSS/JS/icons), so the app opens with zero network in a dead
 *     zone. Bump CACHE_VERSION on every deploy to force a clean refresh.
 *
 *  2) BACKGROUND SYNC — when connectivity returns, the browser fires a
 *     'sync' event on this worker EVEN IF NO TAB IS OPEN. That's the whole
 *     point of Background Sync over a simple `window.ononline` listener:
 *     an engineer can walk out of a dead zone with the phone locked in
 *     their pocket and the sync still fires. Because of that, this worker
 *     talks to IndexedDB directly with the raw API (not Dexie) so it has
 *     zero dependency on the page being alive.
 */

const CACHE_VERSION = 'loop-validator-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const DB_NAME = 'scada_loop_validator_db';
const SYNC_TAG = 'sync-loop-data';

// ---------------------------------------------------------------------------
// Install / Activate — precache shell, clean old caches
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ---------------------------------------------------------------------------
// Fetch — cache-first for shell/static, network-first (falling back to
// cache) for everything else. Never intercept the webhook POST itself;
// that always needs to hit the network live or fail explicitly.
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never cache/intercept POSTs (webhooks)

  const url = new URL(request.url);
  const isStaticAsset = /\.(js|css|png|jpg|jpeg|svg|woff2?|json)$/.test(url.pathname);

  if (isStaticAsset || APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests: try network, fall back to cached shell so deep
  // links still open the app offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
  }
});

// ---------------------------------------------------------------------------
// Background Sync
// ---------------------------------------------------------------------------

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(runSync());
  }
});

// Fallback for browsers without Background Sync (e.g. iOS Safari): the page
// can also ask the SW to sync directly via postMessage when it detects
// `online`, and this listener handles that request identically.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'REQUEST_SYNC') {
    event.waitUntil(runSync());
  }
});

async function runSync() {
  const db = await openDb();
  const settings = await getSettings(db);
  if (!settings || !settings.webhookUrl) {
    await notifyClients({ type: 'SYNC_SKIPPED', reason: 'no-webhook-configured' });
    return;
  }

  const queue = await getAll(db, 'syncQueue');
  if (queue.length === 0) {
    await notifyClients({ type: 'SYNC_COMPLETE', synced: 0 });
    return;
  }

  await notifyClients({ type: 'SYNC_STARTED', pending: queue.length });

  let successCount = 0;
  let failCount = 0;

  // Group queue items by loop so each loop is sent as one payload with its
  // photos attached, rather than N separate photo requests per loop.
  const loopIds = [...new Set(
    queue.filter((q) => q.entityType === 'loop').map((q) => q.entityId)
  )];

  for (const loopId of loopIds) {
    try {
      const loop = await getOne(db, 'loops', loopId);
      if (!loop) continue;

      const photos = await Promise.all(
        loop.photoIds.map((pid) => getOne(db, 'photos', pid))
      );

      const payload = {
        loop: { ...loop, photoIds: undefined },
        photos: await Promise.all(
          photos.filter(Boolean).map(async (p) => ({
            id: p.id,
            filename: `${loop.tagName}_${p.id}.jpg`,
            mimeType: p.mimeType,
            base64: await blobToBase64(p.blob),
          }))
        ),
        device: { userAgent: self.navigator?.userAgent ?? 'service-worker', syncedAt: Date.now() },
      };

      const res = await fetch(settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Webhook responded ${res.status}`);

      await markSynced(db, loopId, loop.photoIds);
      successCount++;
    } catch (err) {
      failCount++;
      await bumpAttempt(db, loopId, String(err));
    }
  }

  await notifyClients({
    type: 'SYNC_COMPLETE',
    synced: successCount,
    failed: failCount,
  });
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
}

// ---------------------------------------------------------------------------
// Minimal raw-IndexedDB helpers (deliberately dependency-free so this
// worker never breaks even if the app bundle changes Dexie versions).
// ---------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getOne(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getSettings(db) {
  return getOne(db, 'settings', 1);
}

async function markSynced(db, loopId, photoIds) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['loops', 'photos', 'syncQueue'], 'readwrite');
    const loopStore = tx.objectStore('loops');
    const photoStore = tx.objectStore('photos');
    const queueStore = tx.objectStore('syncQueue');

    loopStore.get(loopId).onsuccess = (e) => {
      const loop = e.target.result;
      if (loop) {
        loop.syncStatus = 'synced';
        loopStore.put(loop);
      }
    };
    (photoIds || []).forEach((pid) => {
      photoStore.get(pid).onsuccess = (e) => {
        const photo = e.target.result;
        if (photo) {
          photo.syncStatus = 'synced';
          photoStore.put(photo);
        }
      };
    });
    // Clear queue entries for this loop and its photos
    const idx = queueStore.index ? null : null; // no compound index assumed
    queueStore.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      const item = cursor.value;
      const isThisLoop = item.entityType === 'loop' && item.entityId === loopId;
      const isThisPhoto = item.entityType === 'photo' && (photoIds || []).includes(item.entityId);
      if (isThisLoop || isThisPhoto) cursor.delete();
      cursor.continue();
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function bumpAttempt(db, loopId, errorMsg) {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['loops', 'syncQueue'], 'readwrite');
    const loopStore = tx.objectStore('loops');
    const queueStore = tx.objectStore('syncQueue');

    loopStore.get(loopId).onsuccess = (e) => {
      const loop = e.target.result;
      if (loop) {
        loop.syncStatus = 'error';
        loop.syncError = errorMsg;
        loopStore.put(loop);
      }
    };
    queueStore.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      const item = cursor.value;
      if (item.entityType === 'loop' && item.entityId === loopId) {
        item.attempts = (item.attempts || 0) + 1;
        item.lastAttempt = Date.now();
        item.lastError = errorMsg;
        cursor.update(item);
      }
      cursor.continue();
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
