"use client";

export const SETTINGS_UPDATED_EVENT = "spendhound:settings-updated";
export const RECEIPT_REVIEW_UPDATED_EVENT = "spendhound:receipt-review-updated";
export const CHAT_SESSIONS_UPDATED_EVENT = "spendhound:chat-sessions-updated";

export interface ChatSessionsUpdatedDetail {
  sessionId?: string | null;
  reason?: "created" | "updated" | "deleted" | "cleared" | "summarized";
}

export function emitAppEvent<T>(name: string, detail?: T): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function subscribeAppEvent<T>(name: string, listener: (detail: T | undefined) => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = (event: Event) => {
    listener((event as CustomEvent<T>).detail);
  };

  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}
