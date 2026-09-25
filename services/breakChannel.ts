import { Response } from "express";
import { BreakSessionDoc } from "../models/breakSessionModel";

/**
 * Minimal in-process SSE fan-out for break lock/unlock events.
 *
 * Primary delivery is the client's 10s poll of GET /break/current; this
 * channel is only an accelerator (the API runs on Cloud Run with
 * autoscaling, so an in-memory registry cannot reach clients connected to
 * another instance). Enabled by BREAK_SSE_ENABLED.
 */

export type BreakEventType = "break:started" | "break:ended";

export interface BreakEvent {
  type: BreakEventType;
  break: Partial<BreakSessionDoc> | null;
  at: string;
}

const clients = new Map<string, Set<Response>>();
let heartbeat: NodeJS.Timeout | null = null;

function ensureHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    for (const set of clients.values()) {
      for (const res of set) {
        try {
          res.write(": ping\n\n");
        } catch {
          // dropped on close
        }
      }
    }
  }, 25_000);
  // Don't keep the process alive just for the heartbeat.
  heartbeat.unref?.();
}

export function subscribe(userId: string, res: Response): () => void {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(res);
  ensureHeartbeat();
  return () => {
    const s = clients.get(userId);
    if (!s) return;
    s.delete(res);
    if (s.size === 0) clients.delete(userId);
  };
}

export function publish(userId: string, event: BreakEvent): void {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res);
    }
  }
}

export function subscriberCount(): number {
  let n = 0;
  for (const s of clients.values()) n += s.size;
  return n;
}
