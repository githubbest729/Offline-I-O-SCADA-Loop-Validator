import { db, getSettings } from '../db/database';
import type { Loop, PhotoRecord, SyncPayload } from '../types';

export interface SyncResult {
  attempted: number;
  synced: number;
  failed: number;
  errors: Array<{ loopId: number; message: string }>;
}

/**
 * Foreground sync path — mirrors the logic in public/service-worker.js so
 * behavior is identical whether the sync is triggered by Background Sync
 * (tab closed) or by the app noticing it's online (tab open). Kept
 * intentionally simple and idempotent: it's always safe to call this
 * multiple times concurrently, since each loop's sync only clears its own
 * queue entries on success.
 */
export async function syncPendingLoops(): Promise<SyncResult> {
  const settings = await getSettings();
  if (!settings?.webhookUrl) {
    return { attempted: 0, synced: 0, failed: 0, errors: [] };
  }

  const queueItems = await db.syncQueue.toArray();
  const loopIds = [...new Set(
    queueItems.filter((q) => q.entityType === 'loop').map((q) => q.entityId)
  )];

  const result: SyncResult = { attempted: loopIds.length, synced: 0, failed: 0, errors: [] };

  // Sync loops sequentially rather than in parallel: on a flaky field
  // connection, a burst of concurrent large multipart-photo requests is
  // exactly the failure mode we're trying to avoid. Sequential + retry-safe
  // beats fast-but-fragile here.
  for (const loopId of loopIds) {
    try {
      await syncOneLoop(loopId, settings.webhookUrl);
      result.synced++;
    } catch (err) {
      result.failed++;
      result.errors.push({ loopId, message: (err as Error).message });
      await recordSyncError(loopId, (err as Error).message);
    }
  }

  return result;
}

async function syncOneLoop(loopId: number, webhookUrl: string): Promise<void> {
  const loop = await db.loops.get(loopId);
  if (!loop) return;

  const photos = await db.photos.where('loopId').equals(loopId).toArray();
  const payload = await buildPayload(loop, photos);

  const res = await fetchWithTimeout(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, 20_000);

  if (!res.ok) {
    throw new Error(`Webhook responded with ${res.status} ${res.statusText}`);
  }

  await markLoopSynced(loop, photos);
}

async function buildPayload(loop: Loop, photos: PhotoRecord[]): Promise<SyncPayload> {
  const encodedPhotos = await Promise.all(
    photos.map(async (p) => ({
      id: p.id!,
      filename: `${sanitizeFilename(loop.tagName)}_${p.id}.jpg`,
      mimeType: p.mimeType,
      base64: await blobToBase64(p.blob),
    }))
  );

  const { photoIds: _omit, ...loopWithoutPhotoIds } = loop;

  return {
    loop: { ...loopWithoutPhotoIds, id: loop.id! },
    photos: encodedPhotos,
    device: {
      userAgent: navigator.userAgent,
      syncedAt: Date.now(),
    },
  };
}

async function markLoopSynced(loop: Loop, photos: PhotoRecord[]): Promise<void> {
  await db.transaction('rw', db.loops, db.photos, db.syncQueue, async () => {
    await db.loops.update(loop.id!, { syncStatus: 'synced', syncError: undefined });
    await Promise.all(
      photos.map((p) => db.photos.update(p.id!, { syncStatus: 'synced' }))
    );
    // Clear this loop's queue entries (loop + its photos)
    const photoIds = new Set(photos.map((p) => p.id));
    const items = await db.syncQueue.toArray();
    const toDelete = items
      .filter(
        (item) =>
          (item.entityType === 'loop' && item.entityId === loop.id) ||
          (item.entityType === 'photo' && photoIds.has(item.entityId))
      )
      .map((item) => item.id!);
    if (toDelete.length) await db.syncQueue.bulkDelete(toDelete);
  });
}

async function recordSyncError(loopId: number, message: string): Promise<void> {
  await db.transaction('rw', db.loops, db.syncQueue, async () => {
    await db.loops.update(loopId, { syncStatus: 'error', syncError: message });
    const items = await db.syncQueue.where({ entityType: 'loop', entityId: loopId }).toArray();
    for (const item of items) {
      await db.syncQueue.update(item.id!, {
        attempts: item.attempts + 1,
        lastAttempt: Date.now(),
        lastError: message,
      });
    }
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_\-.]/gi, '_');
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
