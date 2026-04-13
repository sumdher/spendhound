"use client";

export const SETTINGS_UPDATED_EVENT = "spendhound:settings-updated";
export const RECEIPT_REVIEW_UPDATED_EVENT = "spendhound:receipt-review-updated";

export function emitAppEvent<T>(name: string, detail?: T): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
