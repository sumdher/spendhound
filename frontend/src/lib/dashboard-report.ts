import type { DashboardAnalytics } from "@/lib/api";
import { convertToEur } from "@/lib/fx-rates";
import { formatCurrency, monthLabel } from "@/lib/utils";

export const DASHBOARD_CHART_COLORS = ["#34d399", "#22c55e", "#84cc16", "#f59e0b", "#fb7185", "#f97316", "#a3e635"];

export interface DashboardSummaryLine {
  value: string;
  colorClass: string;
  primary: boolean;
}

export interface DashboardSummaryStat {
  label: string;
  value: string;
  lines?: DashboardSummaryLine[];
}

function sortedCurrencyEntries(map: Record<string, number>): [string, number][] {
  return Object.entries(map)
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => (a === "EUR" ? -1 : b === "EUR" ? 1 : 0));
}

function currencyLines(map: Record<string, number> | undefined, colorClass: string): DashboardSummaryLine[] {
  if (!map) return [];
  return sortedCurrencyEntries(map).map(([currency, amount], i) => ({
    value: formatCurrency(amount, currency),
    colorClass,
    primary: i === 0,
  }));
}

function netCurrencyLines(map: Record<string, number> | undefined): DashboardSummaryLine[] {
  if (!map) return [];
  return sortedCurrencyEntries(map).map(([currency, amount], i) => ({
    value: formatCurrency(amount, currency),
    colorClass: amount >= 0 ? "text-emerald-400" : "text-red-400",
    primary: i === 0,
  }));
}

/**
 * Converts each item's amount to EUR using the provided FX rate map, then sums.
 * Items whose currency is EUR or not found in `rates` are summed as-is.
 */
export function aggregateWithFx(
  items: Array<{ amount: number; currency: string }>,
  rates: Record<string, number>,
): number {
  return items.reduce((sum, item) => sum + convertToEur(item.amount, item.currency, rates), 0);
}

export function getDashboardSummaryStats(analytics: DashboardAnalytics): DashboardSummaryStat[] {
  const outLines = currencyLines(analytics.summary.money_out_by_currency, "text-red-400");
  const inLines = currencyLines(analytics.summary.money_in_by_currency, "text-emerald-400");
  const netLines = netCurrencyLines(analytics.summary.net_by_currency);

  return [
    {
      label: `Money out · ${monthLabel(analytics.month)}`,
      value: formatCurrency(analytics.summary.money_out),
      lines: outLines.length > 0 ? outLines : undefined,
    },
    {
      label: "Money in",
      value: formatCurrency(analytics.summary.money_in),
      lines: inLines.length > 0 ? inLines : undefined,
    },
    {
      label: "Net",
      value: formatCurrency(analytics.summary.net),
      lines: netLines.length > 0 ? netLines : undefined,
    },
    {
      label: "Transactions",
      value: String(analytics.summary.transaction_count),
    },
    {
      label: "Needs review",
      value: String(analytics.summary.review_count),
    },
  ];
}
