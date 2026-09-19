import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { X, Camera, CheckCircle2, XCircle, Clock, PenLine, Trash2, type LucideIcon } from 'lucide-react';
import { db, setLoopStatus, attachPhoto, signOffLoop } from '../db/database';
import { CameraCapture } from './CameraCapture';
import type { Loop, LoopStatus } from '../types';

interface ValidationCardProps {
  loop: Loop;
  onClose: () => void;
}

/**
 * Full-screen validation workflow for a single loop. Every action here
 * (status toggle, photo capture, sign-off) calls straight into the Dexie
 * transaction helpers — there is no "Save" button and nothing sits only
 * in local component state. Close the tab mid-walk and the last action
 * taken is still the state of the record.
 */
export function ValidationCard({ loop, onClose }: ValidationCardProps) {
  const [showCamera, setShowCamera] = useState(false);
  const [showSignOff, setShowSignOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const photos = useLiveQuery(
    () => db.photos.where('loopId').equals(loop.id!).toArray(),
    [loop.id]
  ) ?? [];

  const handleStatus = async (status: LoopStatus) => {
    setBusy(true);
    try {
      await setLoopStatus(loop.id!, status);
    } finally {
      setBusy(false);
    }
  };

  const handleCapture = async (blob: Blob) => {
    setShowCamera(false);
    await attachPhoto(loop.id!, blob, 'image/jpeg');
  };

  const handleDeletePhoto = async (photoId: number) => {
    await db.transaction('rw', db.photos, db.loops, async () => {
      await db.photos.delete(photoId);
      const current = await db.loops.get(loop.id!);
      if (current) {
        await db.loops.update(loop.id!, {
          photoIds: current.photoIds.filter((id) => id !== photoId),
          lastModified: Date.now(),
        });
      }
    });
  };

  return (
    <div className="fixed inset-0 z-40 bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-slate-800">
        <div className="min-w-0">
          <h2 className="text-xl font-black truncate">{loop.tagName}</h2>
          <p className="text-slate-400 text-sm truncate">{loop.description}</p>
          <p className="text-slate-600 text-xs font-mono mt-1">
            {loop.signalType} · {loop.plcAddress}
          </p>
        </div>
        <button onClick={onClose} className="p-3 rounded-xl bg-slate-800 min-h-[44px] min-w-[44px]" aria-label="Close">
          <X size={22} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Status toggles — large touch targets, unambiguous color coding */}
        <section>
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-3">Field Status</h3>
          <div className="grid grid-cols-3 gap-3">
            <StatusButton
              label="Pending"
              icon={Clock}
              active={loop.status === 'Pending'}
              activeClass="bg-slate-600 border-slate-500"
              onClick={() => handleStatus('Pending')}
              disabled={busy}
            />
            <StatusButton
              label="Passed"
              icon={CheckCircle2}
              active={loop.status === 'Passed'}
              activeClass="bg-emerald-600 border-emerald-500"
              onClick={() => handleStatus('Passed')}
              disabled={busy}
            />
            <StatusButton
              label="Failed"
              icon={XCircle}
              active={loop.status === 'Failed'}
              activeClass="bg-red-600 border-red-500"
              onClick={() => handleStatus('Failed')}
              disabled={busy}
            />
          </div>
        </section>

        {/* Photos */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide">
              Instrumentation Photos ({photos.length})
            </h3>
            <button
              onClick={() => setShowCamera(true)}
              className="flex items-center gap-2 bg-cyan-600 active:bg-cyan-700 px-4 py-3 rounded-xl text-sm font-semibold min-h-[44px]"
            >
              <Camera size={18} /> Capture
            </button>
          </div>
          {photos.length === 0 ? (
            <p className="text-slate-600 text-sm py-4 text-center border border-dashed border-slate-800 rounded-xl">
              No photos yet
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p) => (
                <PhotoThumb key={p.id} blob={p.blob} onDelete={() => handleDeletePhoto(p.id!)} />
              ))}
            </div>
          )}
        </section>

        {/* Sign-off */}
        <section>
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-3">Digital Sign-off</h3>
          {loop.signedBy ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="font-semibold">{loop.signedBy}</p>
              <p className="text-slate-500 text-sm">
                {loop.signedAt ? new Date(loop.signedAt).toLocaleString() : ''}
              </p>
            </div>
          ) : (
            <button
              onClick={() => setShowSignOff(true)}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 active:bg-slate-700 py-4 rounded-xl font-semibold min-h-[52px]"
            >
              <PenLine size={20} /> Sign Off This Loop
            </button>
          )}
        </section>
      </div>

      {showCamera && (
        <CameraCapture onCapture={handleCapture} onClose={() => setShowCamera(false)} />
      )}
      {showSignOff && (
        <SignOffSheet
          onClose={() => setShowSignOff(false)}
          onConfirm={async (name) => {
            await signOffLoop(loop.id!, name);
            setShowSignOff(false);
          }}
        />
      )}
    </div>
  );
}

function StatusButton({ label, icon: Icon, active, activeClass, onClick, disabled }: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  activeClass: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-2 py-4 rounded-xl border-2 font-bold text-sm min-h-[80px] transition-colors disabled:opacity-50 ${
        active ? activeClass + ' text-white' : 'bg-slate-900 border-slate-800 text-slate-400'
      }`}
    >
      <Icon size={28} />
      {label}
    </button>
  );
}

function PhotoThumb({ blob, onDelete }: { blob: Blob; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  React.useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  return (
    <div className="relative aspect-square rounded-lg overflow-hidden bg-slate-900">
      {url && <img src={url} alt="Instrumentation" className="w-full h-full object-cover" />}
      <button
        onClick={onDelete}
        className="absolute top-1 right-1 p-1.5 rounded-full bg-black/60 min-h-[32px] min-w-[32px]"
        aria-label="Delete photo"
      >
        <Trash2 size={14} className="text-red-400" />
      </button>
    </div>
  );
}

function SignOffSheet({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end">
      <div className="w-full bg-slate-900 rounded-t-2xl p-6 space-y-4">
        <h2 className="text-lg font-bold">Sign Off</h2>
        <p className="text-sm text-slate-400">
          Enter your name to digitally sign off this loop. A timestamp is recorded automatically.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          autoFocus
          className="w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-base"
        />
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-slate-800 font-semibold min-h-[48px]">
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onConfirm(name.trim())}
            disabled={!name.trim()}
            className="flex-1 py-3 rounded-xl bg-cyan-600 font-semibold min-h-[48px] disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
