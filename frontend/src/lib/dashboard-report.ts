import type { DashboardAnalytics } from "@/lib/api";
import { formatCurrency, monthLabel } from "@/lib/utils";

export const DASHBOARD_CHART_COLORS = ["#34d399", "#22c55e", "#84cc16", "#f59e0b", "#fb7185", "#f97316", "#a3e635"];

export interface DashboardSummaryStat {
  label: string;
  value: string;
}

export function getDashboardSummaryStats(analytics: DashboardAnalytics): DashboardSummaryStat[] {
  return [
    {
      label: `Money out · ${monthLabel(analytics.month)}`,
      value: formatCurrency(analytics.summary.money_out),
    },
    {
      label: "Money in",
      value: formatCurrency(analytics.summary.money_in),
    },
    {
      label: "Net",
      value: formatCurrency(analytics.summary.net),
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
