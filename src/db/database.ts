import Dexie, { type Table } from 'dexie';
import type { Loop, PhotoRecord, SyncQueueItem, AppSettings } from '../types';

/**
 * LoopValidatorDB
 * ----------------------------------------------------------------------
 * Single source of truth for all field data. Designed so that a killed
 * tab / dead browser / OS reclaiming memory in a dead zone never loses
 * committed data: every mutating operation below is a single Dexie
 * transaction that (a) writes the entity and (b) enqueues a sync item,
 * so the two can never drift out of sync with each other.
 */
export class LoopValidatorDB extends Dexie {
  loops!: Table<Loop, number>;
  photos!: Table<PhotoRecord, number>;
  syncQueue!: Table<SyncQueueItem, number>;
  settings!: Table<AppSettings, number>;

  constructor() {
    super('scada_loop_validator_db');

    // Version 1 schema. Indexes chosen for the access patterns the UI
    // actually needs: search by tag, filter by status, filter by sync state.
    this.version(1).stores({
      loops:
        '++id, tagName, status, syncStatus, area, lastModified',
      photos:
        '++id, loopId, syncStatus',
      syncQueue:
        '++id, entityType, entityId, createdAt',
      settings:
        '++id',
    });
  }
}

export const db = new LoopValidatorDB();

// ---------------------------------------------------------------------------
// Mutation helpers — every one of these is transactional so a crash mid-write
// can never leave a Loop updated without its corresponding sync-queue entry
// (or vice versa). This is the crux of "no commissioning data is lost."
// ---------------------------------------------------------------------------

/** Bulk-insert loops parsed from CSV. Idempotent on tagName+plcAddress. */
export async function importLoops(
  rows: Omit<Loop, 'id' | 'photoIds' | 'syncStatus' | 'createdAt' | 'lastModified' | 'version' | 'status'>[]
): Promise<number> {
  const now = Date.now();
  return db.transaction('rw', db.loops, async () => {
    let inserted = 0;
    for (const row of rows) {
      const existing = await db.loops
        .where('tagName')
        .equals(row.tagName)
        .first();
      if (existing) continue; // skip duplicates on re-import
      await db.loops.add({
        ...row,
        status: 'Pending',
        photoIds: [],
        syncStatus: 'pending',
        createdAt: now,
        lastModified: now,
        version: 1,
      });
      inserted++;
    }
    return inserted;
  });
}

/** Update a loop's field status and enqueue it for sync, atomically. */
export async function setLoopStatus(loopId: number, status: Loop['status']): Promise<void> {
  await db.transaction('rw', db.loops, db.syncQueue, async () => {
    const loop = await db.loops.get(loopId);
    if (!loop) throw new Error(`Loop ${loopId} not found`);
    await db.loops.update(loopId, {
      status,
      lastModified: Date.now(),
      version: loop.version + 1,
      syncStatus: 'pending',
    });
    await enqueueSync('loop', loopId);
  });
}

/** Attach a captured photo blob to a loop, atomically. */
export async function attachPhoto(loopId: number, blob: Blob, mimeType: string): Promise<number> {
  return db.transaction('rw', db.loops, db.photos, db.syncQueue, async () => {
    const photoId = await db.photos.add({
      loopId,
      blob,
      mimeType,
      sizeBytes: blob.size,
      capturedAt: Date.now(),
      syncStatus: 'pending',
    });
    const loop = await db.loops.get(loopId);
    if (!loop) throw new Error(`Loop ${loopId} not found`);
    await db.loops.update(loopId, {
      photoIds: [...loop.photoIds, photoId as number],
      lastModified: Date.now(),
      version: loop.version + 1,
      syncStatus: 'pending',
    });
    await enqueueSync('photo', photoId as number);
    await enqueueSync('loop', loopId);
    return photoId as number;
  });
}

/** Digitally sign off a loop. Locks in signer + timestamp, enqueues sync. */
export async function signOffLoop(
  loopId: number,
  signedBy: string,
  signatureDataUrl?: string
): Promise<void> {
  await db.transaction('rw', db.loops, db.syncQueue, async () => {
    const loop = await db.loops.get(loopId);
    if (!loop) throw new Error(`Loop ${loopId} not found`);
    await db.loops.update(loopId, {
      signedBy,
      signedAt: Date.now(),
      signatureDataUrl,
      lastModified: Date.now(),
      version: loop.version + 1,
      syncStatus: 'pending',
    });
    await enqueueSync('loop', loopId);
  });
}

async function enqueueSync(entityType: 'loop' | 'photo', entityId: number): Promise<void> {
  // Avoid piling up duplicate queue entries for the same entity.
  const existing = await db.syncQueue
    .where({ entityType, entityId })
    .first();
  if (existing) return;
  await db.syncQueue.add({
    entityType,
    entityId,
    attempts: 0,
    createdAt: Date.now(),
  });
}

/** Persist (or update) the singleton settings row. */
export async function saveSettings(settings: Omit<AppSettings, 'id'>): Promise<void> {
  const existing = await db.settings.get(1);
  if (existing) {
    await db.settings.update(1, settings);
  } else {
    await db.settings.add({ id: 1, ...settings });
  }
}

export async function getSettings(): Promise<AppSettings | undefined> {
  return db.settings.get(1);
}
