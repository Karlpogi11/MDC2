/**
 * Simple offline queue backed by localStorage.
 * Stores failed operations and replays them when connection is restored.
 */

const QUEUE_KEY = "mdc_offline_queue";

export type QueuedOp = {
  id: string;
  type: "stock_in_batch";
  payload: {
    serials: { serial: string; partNumber: string; partName: string }[];
    actorId: string;
  };
  queuedAt: string;
};

export function enqueueOp(op: Omit<QueuedOp, "id" | "queuedAt">) {
  const queue = getQueue();
  queue.push({ ...op, id: crypto.randomUUID(), queuedAt: new Date().toISOString() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function getQueue(): QueuedOp[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function removeFromQueue(id: string) {
  const queue = getQueue().filter((op) => op.id !== id);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY);
}
