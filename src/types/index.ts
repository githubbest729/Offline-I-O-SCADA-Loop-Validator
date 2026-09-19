// ============================================================================
// Domain types — Offline I/O & SCADA Loop Validator
// ============================================================================

export type LoopStatus = 'Pending' | 'Passed' | 'Failed';
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';
export type SignalType =
  | 'AI' | 'AO' | 'DI' | 'DO' | 'PID' | 'PULSE' | 'STRING' | 'OTHER';

/**
 * A single field-validation record, one row from the imported CSV,
 * enriched with field-execution state.
 */
export interface Loop {
  /** Dexie auto-increment primary key */
  id?: number;

  // --- Imported from CSV (AVEVA System Platform / PLC tag export) ---
  tagName: string;          // e.g. "FIC-101.PV"
  description: string;      // e.g. "Feedwater Flow Controller"
  signalType: SignalType | string;
  plcAddress: string;       // e.g. "%MW1024" or "DB12.DBD40"
  area?: string;            // optional grouping (e.g. "Unit 200")

  // --- Field execution state ---
  status: LoopStatus;
  notes?: string;

  /** IDs of associated PhotoRecord rows (field-of-truth is the photos table) */
  photoIds: number[];

  /** Digital sign-off */
  signedBy?: string;
  signedAt?: number;        // epoch ms
  signatureDataUrl?: string; // base64 PNG of a captured signature pad, optional

  // --- Sync bookkeeping ---
  syncStatus: SyncStatus;
  syncError?: string;
  remoteId?: string;        // ID returned by n8n/ClickUp once synced

  // --- Integrity / audit ---
  createdAt: number;        // epoch ms, set on CSV import
  lastModified: number;     // epoch ms, bumped on every mutation
  version: number;          // monotonically increasing local revision counter
}

/**
 * A photo captured against a loop. Stored as a Blob directly in IndexedDB
 * (Dexie supports Blob storage natively) so nothing depends on an external
 * file system or object URL surviving a browser restart.
 */
export interface PhotoRecord {
  id?: number;
  loopId: number;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  capturedAt: number;
  syncStatus: SyncStatus;
  remoteUrl?: string;       // populated after successful upload
}

/**
 * Generic outbox pattern: every mutation that needs to leave the device
 * enqueues an item here. The sync engine drains this queue rather than
 * re-scanning the whole loops table, which keeps sync idempotent and cheap.
 */
export interface SyncQueueItem {
  id?: number;
  entityType: 'loop' | 'photo';
  entityId: number;
  attempts: number;
  lastAttempt?: number;
  lastError?: string;
  createdAt: number;
}

export interface AppSettings {
  id?: number; // singleton row, id = 1
  webhookUrl: string;
  webhookType: 'n8n' | 'clickup' | 'custom';
  clickupListId?: string;   // only used when webhookType === 'clickup' via n8n bridge
  projectName?: string;
  csvImportedAt?: number;
  csvSourceFilename?: string;
}

/** Shape of a parsed CSV row before it's normalized into a Loop */
export interface CsvTagRow {
  'Tag Name': string;
  'Description': string;
  'Signal Type': string;
  'PLC Address': string;
  'Area'?: string;
  [key: string]: string | undefined;
}

/** Payload shape POSTed to the webhook (n8n / ClickUp bridge) */
export interface SyncPayload {
  loop: Omit<Loop, 'photoIds'> & { id: number };
  photos: Array<{
    id: number;
    filename: string;
    mimeType: string;
    base64: string; // photos are base64-encoded for the JSON webhook body
  }>;
  device: {
    userAgent: string;
    syncedAt: number;
  };
}
