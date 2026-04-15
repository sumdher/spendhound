import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | null | undefined, currency = "EUR") {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function signedTransactionAmount(amount: number | null | undefined, transactionType: string | null | undefined) {
  if (amount === null || amount === undefined) return null;
  return transactionType === "credit" ? amount : -amount;
}

export function formatSignedCurrency(amount: number | null | undefined, transactionType: string | null | undefined, currency = "EUR") {
  const signed = signedTransactionAmount(amount, transactionType);
  if (signed === null) return "—";
  return formatCurrency(signed, currency);
}

export function transactionTypeLabel(transactionType: string | null | undefined) {
  return transactionType === "credit" ? "Money in" : "Money out";
}

export function transactionCadenceLabel(cadence: string | null | undefined, cadenceInterval?: number | null) {
  switch (cadence) {
    case "monthly":
      return "Monthly recurring";
    case "yearly":
      return "Yearly recurring";
    case "custom":
      return cadenceInterval ? `Every ${cadenceInterval} months` : "Custom interval";
    case "prepaid":
      return "Prepaid subscription";
    default:
      return "One-time / irregular";
  }
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function monthLabel(month: string) {
  if (!month || month === "all") return "All time";
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

export function currentMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(year, monthNumber - 1 + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

export function recentMonthOptions(count = 12, anchorMonth = currentMonthString()) {
  return Array.from({ length: count }, (_, index) => shiftMonth(anchorMonth, -index));
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
