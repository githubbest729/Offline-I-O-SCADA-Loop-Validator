import { useEffect, useState } from 'react';

export type SyncMessage =
  | { type: 'SYNC_STARTED'; pending: number }
  | { type: 'SYNC_COMPLETE'; synced: number; failed?: number }
  | { type: 'SYNC_SKIPPED'; reason: string };

interface OnlineStatus {
  isOnline: boolean;
  syncState: 'idle' | 'syncing' | 'error';
  lastSyncMessage: SyncMessage | null;
}

/**
 * Tracks navigator.onLine AND listens for postMessage events coming back
 * from the service worker's Background Sync handler, so the UI can show a
 * live "Syncing 4 loops…" indicator even though the actual sync happens in
 * a worker thread the React tree has no direct handle on.
 */
export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncState, setSyncState] = useState<OnlineStatus['syncState']>('idle');
  const [lastSyncMessage, setLastSyncMessage] = useState<SyncMessage | null>(null);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const onMessage = (event: MessageEvent) => {
      const msg = event.data as SyncMessage | undefined;
      if (!msg?.type) return;
      setLastSyncMessage(msg);
      if (msg.type === 'SYNC_STARTED') setSyncState('syncing');
      if (msg.type === 'SYNC_COMPLETE') {
        setSyncState(msg.failed && msg.failed > 0 ? 'error' : 'idle');
      }
      if (msg.type === 'SYNC_SKIPPED') setSyncState('idle');
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, []);

  return { isOnline, syncState, lastSyncMessage };
}
