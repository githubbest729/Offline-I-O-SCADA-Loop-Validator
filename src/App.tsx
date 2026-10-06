import React, { useMemo, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Wifi, WifiOff, RefreshCw, Search, Upload,
  CheckCircle2, XCircle, Clock, AlertTriangle, Settings as SettingsIcon,
  HelpCircle, FileSpreadsheet
} from 'lucide-react';
import { db, importLoops, saveSettings, getSettings } from './db/database';
import { parseTagCsv } from './utils/csvParser';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { ValidationCard } from './components/ValidationCard';
import type { Loop, LoopStatus } from './types';

type FilterTab = 'All' | LoopStatus;

export default function App() {
  const { isOnline, syncState } = useOnlineStatus();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterTab>('All');
  const [activeLoopId, setActiveLoopId] = useState<number | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false); // Added Help State

  // Live-queried directly from IndexedDB.
  const loops = useLiveQuery(() => db.loops.orderBy('tagName').toArray(), []) ?? [];
  const settings = useLiveQuery(() => getSettings(), []);
  const pendingSyncCount = useLiveQuery(() => db.syncQueue.count(), []) ?? 0;

  const counts = useMemo(() => {
    const c = { All: loops.length, Pending: 0, Passed: 0, Failed: 0 } as Record<FilterTab, number>;
    loops.forEach((l) => { c[l.status]++; });
    return c;
  }, [loops]);

  const filteredLoops = useMemo(() => {
    const term = search.trim().toLowerCase();
    return loops.filter((l) => {
      const matchesFilter = filter === 'All' || l.status === filter;
      const matchesSearch =
        !term ||
        l.tagName.toLowerCase().includes(term) ||
        l.description.toLowerCase().includes(term) ||
        l.plcAddress.toLowerCase().includes(term);
      return matchesFilter && matchesSearch;
    });
  }, [loops, search, filter]);

  const handleCsvUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportBusy(true);
    setImportMsg(null);
    try {
      const { rows, errors, skippedRowCount } = await parseTagCsv(file);
      const inserted = await importLoops(rows);
      let msg = `Imported ${inserted} new loop(s) from ${rows.length} row(s).`;
      if (skippedRowCount) msg += ` Skipped ${skippedRowCount} row(s) missing a Tag Name.`;
      if (errors.length) msg += ` (${errors.length} parse warning(s).)`;
      setImportMsg(msg);
    } catch (err) {
      setImportMsg(`Import failed: ${(err as Error).message}`);
    } finally {
      setImportBusy(false);
      e.target.value = '';
    }
  }, []);

  const activeLoop = loops.find((l) => l.id === activeLoopId) ?? null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* ---- Status Bar ---- */}
      <header className="sticky top-0 z-20 bg-slate-900 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <StatusPill isOnline={isOnline} syncState={syncState} pendingCount={pendingSyncCount} />
          </div>
          <h1 className="text-base font-bold tracking-tight truncate hidden sm:block">
            Loop Validator
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <label className="flex items-center gap-2 bg-cyan-600 active:bg-cyan-700 text-white font-semibold px-4 py-3 rounded-xl cursor-pointer text-sm min-h-[44px]">
              <Upload size={18} />
              <span className="hidden sm:inline">Import CSV</span>
              <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
            </label>
            <button
              onClick={() => setShowHelp(true)}
              className="p-3 rounded-xl bg-slate-800 active:bg-slate-700 min-h-[44px] min-w-[44px] text-slate-300"
              aria-label="Help & Information"
            >
              <HelpCircle size={18} />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-3 rounded-xl bg-slate-800 active:bg-slate-700 min-h-[44px] min-w-[44px]"
              aria-label="Settings"
            >
              <SettingsIcon size={18} />
            </button>
          </div>
        </div>
        {importBusy && (
          <p className="text-xs text-cyan-400 mt-2 animate-pulse">Parsing CSV…</p>
        )}
        {importMsg && !importBusy && (
          <p className="text-xs text-slate-400 mt-2">{importMsg}</p>
        )}
      </header>

      {/* ---- Search + Filters ---- */}
      <div className="px-4 pt-3 pb-2 bg-slate-950 sticky top-[64px] z-10 border-b border-slate-900">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={20} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tag, description, address…"
            className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-base placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {(['All', 'Pending', 'Passed', 'Failed'] as FilterTab[]).map((tab) => (
            <FilterChip
              key={tab}
              label={tab}
              count={counts[tab]}
              active={filter === tab}
              onClick={() => setFilter(tab)}
            />
          ))}
        </div>
      </div>

      {/* ---- Loop List ---- */}
      <main className="flex-1 px-4 py-3 pb-24 space-y-3">
        {loops.length === 0 && (
          <EmptyState onOpenHelp={() => setShowHelp(true)} />
        )}
        {loops.length > 0 && filteredLoops.length === 0 && (
          <p className="text-center text-slate-500 py-12">No loops match your search/filter.</p>
        )}
        {filteredLoops.map((loop) => (
          <LoopRow key={loop.id} loop={loop} onOpen={() => setActiveLoopId(loop.id!)} />
        ))}
      </main>

      {activeLoop && (
        <ValidationCard
          loop={activeLoop}
          onClose={() => setActiveLoopId(null)}
        />
      )}

      {showSettings && (
        <SettingsSheet
          initial={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (s) => {
            await saveSettings(s);
            setShowSettings(false);
          }}
        />
      )}

      {showHelp && (
        <HelpSheet onClose={() => setShowHelp(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational subcomponents
// ---------------------------------------------------------------------------

function StatusPill({ isOnline, syncState, pendingCount }: {
  isOnline: boolean; syncState: 'idle' | 'syncing' | 'error'; pendingCount: number;
}) {
  if (syncState === 'syncing') {
    return (
      <div className="flex items-center gap-2 bg-amber-500/20 text-amber-400 px-3 py-2 rounded-xl text-sm font-semibold">
        <RefreshCw size={16} className="animate-spin" />
        Syncing…
      </div>
    );
  }
  if (!isOnline) {
    return (
      <div className="flex items-center gap-2 bg-red-500/20 text-red-400 px-3 py-2 rounded-xl text-sm font-semibold">
        <WifiOff size={16} />
        Offline{pendingCount > 0 ? ` · ${pendingCount} queued` : ''}
      </div>
    );
  }
  if (pendingCount > 0) {
    return (
      <div className="flex items-center gap-2 bg-amber-500/20 text-amber-400 px-3 py-2 rounded-xl text-sm font-semibold">
        <Wifi size={16} />
        {pendingCount} pending
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 bg-emerald-500/20 text-emerald-400 px-3 py-2 rounded-xl text-sm font-semibold">
      <Wifi size={16} />
      Synced
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold min-h-[40px] border transition-colors ${
        active
          ? 'bg-cyan-600 border-cyan-600 text-white'
          : 'bg-slate-900 border-slate-800 text-slate-400'
      }`}
    >
      {label} <span className="opacity-70">({count})</span>
    </button>
  );
}

function LoopRow({ loop, onOpen }: { loop: Loop; onOpen: () => void }) {
  const statusStyles: Record<LoopStatus, string> = {
    Pending: 'border-l-slate-600',
    Passed: 'border-l-emerald-500',
    Failed: 'border-l-red-500',
  };
  const StatusIcon = loop.status === 'Passed' ? CheckCircle2
    : loop.status === 'Failed' ? XCircle
    : Clock;
  const iconColor = loop.status === 'Passed' ? 'text-emerald-500'
    : loop.status === 'Failed' ? 'text-red-500'
    : 'text-slate-500';

  return (
    <button
      onClick={onOpen}
      className={`w-full text-left bg-slate-900 border-l-4 ${statusStyles[loop.status]} rounded-xl p-4 flex items-center gap-3 active:bg-slate-800 min-h-[72px]`}
    >
      <StatusIcon className={iconColor} size={28} />
      <div className="min-w-0 flex-1">
        <p className="font-bold text-base truncate">{loop.tagName}</p>
        <p className="text-sm text-slate-400 truncate">{loop.description}</p>
        <p className="text-xs text-slate-600 font-mono truncate">{loop.plcAddress}</p>
      </div>
      {loop.syncStatus === 'error' && (
        <AlertTriangle className="text-amber-500 shrink-0" size={20} />
      )}
    </button>
  );
}

function EmptyState({ onOpenHelp }: { onOpenHelp: () => void }) {
  const handleDownloadTemplate = () => {
    const csvContent =
      "data:text/csv;charset=utf-8," +
      "Tag Name,Description,Signal Type,PLC Address,Area\n" +
      "FIC-101.PV,Feedwater Flow Controller,AI,%MW1024,Unit 200\n" +
      "XV-204,Isolation Valve,DO,%QX2.3,Unit 200";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "sample_loop_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-md mx-auto text-center py-12 px-4 space-y-4">
      <div className="w-14 h-14 bg-cyan-950 text-cyan-400 rounded-2xl flex items-center justify-center mx-auto">
        <FileSpreadsheet size={28} />
      </div>

      <div>
        <h2 className="text-lg font-bold text-slate-100">Offline I/O Loop Validator</h2>
        <p className="text-slate-400 text-sm mt-1">
          Commissioning tool for field verification of PLC and SCADA I/O loops. Works 100% offline with zero data loss.
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-left text-xs space-y-2 font-mono text-slate-300">
        <p className="font-semibold text-slate-400 uppercase tracking-wider font-sans">Required CSV Format:</p>
        <p className="text-cyan-400">Tag Name, Description, Signal Type, PLC Address, Area</p>
      </div>

      <div className="flex gap-2 justify-center pt-2">
        <button
          onClick={handleDownloadTemplate}
          className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition"
        >
          Download Sample CSV
        </button>
        <button
          onClick={onOpenHelp}
          className="px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-sm font-semibold transition"
        >
          How it Works
        </button>
      </div>
    </div>
  );
}

function SettingsSheet({ initial, onClose, onSave }: {
  initial: { webhookUrl: string; webhookType: 'n8n' | 'clickup' | 'custom' } | undefined;
  onClose: () => void;
  onSave: (s: { webhookUrl: string; webhookType: 'n8n' | 'clickup' | 'custom' }) => void;
}) {
  const [url, setUrl] = useState(initial?.webhookUrl ?? '');
  const [type, setType] = useState<'n8n' | 'clickup' | 'custom'>(initial?.webhookType ?? 'n8n');

  return (
    <div className="fixed inset-0 z-30 bg-black/70 flex items-end">
      <div className="w-full bg-slate-900 rounded-t-2xl p-6 space-y-4">
        <h2 className="text-lg font-bold">Sync Settings</h2>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Webhook target</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3"
          >
            <option value="n8n">n8n</option>
            <option value="clickup">ClickUp (via n8n bridge)</option>
            <option value="custom">Custom endpoint</option>
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Webhook URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-n8n-instance.com/webhook/loop-sync"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl p-3 font-mono text-sm"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl bg-slate-800 font-semibold min-h-[48px]">
            Cancel
          </button>
          <button
            onClick={() => onSave({ webhookUrl: url, webhookType: type })}
            className="flex-1 py-3 rounded-xl bg-cyan-600 font-semibold min-h-[48px]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 bg-black/70 flex items-end sm:items-center sm:justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-slate-900 rounded-t-2xl sm:rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <h2 className="text-lg font-bold">About Loop Validator</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white">✕</button>
        </div>

        <div className="text-sm text-slate-300 space-y-3">
          <p>
            This tool is designed for instrumentation & control engineers to perform field checkouts and loop tests in plant areas with poor or no network connectivity.
          </p>

          <h3 className="font-bold text-cyan-400">Workflow:</h3>
          <ol className="list-decimal pl-5 space-y-1.5 text-slate-400">
            <li><strong className="text-slate-200">Import CSV:</strong> Load your tag database.</li>
            <li><strong className="text-slate-200">Validate Loops:</strong> Mark tags as Passed/Failed, attach photos, and sign off.</li>
            <li><strong className="text-slate-200">Automatic Sync:</strong> Once online, all checkouts automatically sync to your configured webhook (n8n/ClickUp).</li>
          </ol>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-cyan-600 font-semibold text-white mt-4"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
