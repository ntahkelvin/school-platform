// Keeps work safe when the internet drops.
//
// 1. Saves that can't reach the server go into an "outbox" stored on the device.
// 2. The outbox is re-sent automatically when the connection comes back.
// 3. The last copy of each register is kept on the device, so it can be reopened offline.

import { useEffect, useState } from "react";
import { ApiError, request } from "./api";

export interface OutboxItem {
  key: string; // one item per register and date: a newer save replaces an older unsent one
  method: string;
  path: string;
  body: unknown;
  label: string;
  queuedAt: string;
}

export interface SyncStatus {
  online: boolean;
  pending: OutboxItem[];
  failed: { label: string; message: string }[];
  syncing: boolean;
}

const OUTBOX_KEY = "sp_outbox";
const CACHE_PREFIX = "sp_cache:";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: nothing more we can do */
  }
}

export const cache = {
  get: <T,>(key: string): T | null => read<T | null>(CACHE_PREFIX + key, null),
  set: (key: string, value: unknown) => write(CACHE_PREFIX + key, value),
};

let status: SyncStatus = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  pending: read<OutboxItem[]>(OUTBOX_KEY, []),
  failed: [],
  syncing: false,
};
const listeners = new Set<(s: SyncStatus) => void>();

function update(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  if (patch.pending) write(OUTBOX_KEY, patch.pending);
  listeners.forEach((fn) => fn(status));
}

export function pendingFor(key: string): OutboxItem | undefined {
  return status.pending.find((i) => i.key === key);
}

/** A network problem (no signal, server unreachable), as opposed to the server saying no. */
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError);
}

/**
 * Tries to save now. If there's no connection, keeps it in the outbox and returns { queued: true }.
 * Errors from the server itself (e.g. "future date") are thrown so the screen can show them.
 */
export async function saveOrQueue<T>(item: Omit<OutboxItem, "queuedAt">): Promise<{ queued: false; data: T } | { queued: true }> {
  const queue = () => {
    const pending = [...status.pending.filter((i) => i.key !== item.key), { ...item, queuedAt: new Date().toISOString() }];
    update({ pending });
    return { queued: true as const };
  };
  if (!navigator.onLine) return queue();
  try {
    const data = await request<T>(item.path, { method: item.method, body: JSON.stringify(item.body) });
    // A newer save went through, so any older queued copy is out of date.
    if (pendingFor(item.key)) update({ pending: status.pending.filter((i) => i.key !== item.key) });
    update({ online: true });
    return { queued: false, data };
  } catch (err) {
    if (isNetworkError(err)) {
      update({ online: false });
      return queue();
    }
    throw err;
  }
}

/** Sends everything in the outbox, oldest first. Stops at the first network failure. */
export async function flushOutbox(): Promise<void> {
  if (status.syncing || status.pending.length === 0) return;
  update({ syncing: true });
  try {
    for (const item of [...status.pending]) {
      try {
        await request(item.path, { method: item.method, body: JSON.stringify(item.body) });
        update({ online: true, pending: status.pending.filter((i) => i !== item) });
      } catch (err) {
        if (isNetworkError(err)) {
          update({ online: false });
          return;
        }
        // The server refused it (e.g. a student was removed). Drop it and tell the user.
        update({
          pending: status.pending.filter((i) => i !== item),
          failed: [...status.failed, { label: item.label, message: (err as Error).message }],
        });
      }
    }
  } finally {
    update({ syncing: false });
  }
}

export function dismissFailures(): void {
  update({ failed: [] });
}

let started = false;
export function startSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", () => {
    update({ online: true });
    void flushOutbox();
  });
  window.addEventListener("offline", () => update({ online: false }));
  setInterval(() => void flushOutbox(), 20_000);
  void flushOutbox();
}

export function useSyncStatus(): SyncStatus {
  const [s, setS] = useState(status);
  useEffect(() => {
    listeners.add(setS);
    setS(status);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}
