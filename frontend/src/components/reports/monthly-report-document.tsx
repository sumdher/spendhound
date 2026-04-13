import type { CSSProperties, ReactNode } from "react";
import type { DashboardAnalytics } from "@/lib/api";
import { DASHBOARD_CHART_COLORS, getDashboardSummaryStats } from "@/lib/dashboard-report";
import { formatCurrency, formatDate, formatSignedCurrency, monthLabel, transactionCadenceLabel, transactionTypeLabel } from "@/lib/utils";

interface MonthlyReportDocumentProps {
  userEmail: string;
  userName?: string | null;
  reportMonth: string;
  generatedAt: string;
  analytics: DashboardAnalytics;
}

export const monthlyReportStyles = `
  @page {
    size: A4;
    margin: 14mm 12mm 16mm;
  }

  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    padding: 0;
    font-family: Inter, Arial, Helvetica, sans-serif;
    color: #e8f4ec;
    background: #07130d;
  }

  body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    min-height: 100vh;
    padding: 0;
    background:
      radial-gradient(circle at top, rgba(52, 211, 153, 0.18), transparent 28%),
      radial-gradient(circle at 18% 18%, rgba(20, 83, 45, 0.25), transparent 22%),
      #07130d;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    margin-bottom: 20px;
  }

  .brand {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #7dd3a7;
    margin-bottom: 10px;
  }

  h1, h2, h3, p {
    margin: 0;
  }

  h1 {
    font-size: 30px;
    line-height: 1.1;
    margin-bottom: 8px;
  }

  .lede {
    max-width: 700px;
    color: #a7c2b1;
    font-size: 13px;
    line-height: 1.5;
  }

  .meta-card, .card {
    background: rgba(10, 25, 17, 0.92);
    border: 1px solid rgba(93, 132, 111, 0.35);
    border-radius: 18px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
  }

  .meta-card {
    min-width: 240px;
    padding: 16px;
  }

  .meta-grid {
    display: grid;
    gap: 10px;
  }

  .meta-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #7c9c88;
  }

  .meta-value {
    font-size: 13px;
    color: #f4fbf7;
  }

  .summary-grid,
  .two-column-grid {
    display: grid;
    gap: 12px;
  }

  .summary-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    margin-bottom: 18px;
  }

  .two-column-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-bottom: 14px;
  }

  .card {
    padding: 18px;
    break-inside: avoid;
    margin-bottom: 14px;
  }

  .stat-card {
    padding: 16px;
  }

  .stat-label {
    font-size: 12px;
    color: #9bb7a6;
    margin-bottom: 10px;
  }

  .stat-value {
    font-size: 24px;
    font-weight: 700;
    color: #f4fbf7;
  }

  .section-title {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 4px;
  }

  .section-description {
    font-size: 12px;
    color: #9bb7a6;
    margin-bottom: 14px;
    line-height: 1.5;
  }

  .chart-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(220px, 0.9fr);
    gap: 16px;
    align-items: center;
  }

  .legend-list,
  .stack-list {
    display: grid;
    gap: 8px;
  }

  .legend-item,
  .list-item,
  .budget-row,
  .insight-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: rgba(7, 19, 13, 0.75);
    border: 1px solid rgba(93, 132, 111, 0.24);
    border-radius: 14px;
  }

  .legend-name {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    flex: 0 0 auto;
  }

  .list-copy {
    display: grid;
    gap: 4px;
  }

  .list-title {
    font-size: 13px;
    font-weight: 600;
    color: #f4fbf7;
  }

  .list-subtitle,
  .muted,
  .table-note {
    font-size: 11px;
    color: #9bb7a6;
    line-height: 1.45;
  }

  .list-value {
    font-size: 13px;
    font-weight: 600;
    text-align: right;
  }

  .positive {
    color: #86efac;
  }

  .negative {
    color: #fda4af;
  }

  .neutral {
    color: #f4fbf7;
  }

  .empty {
    padding: 26px 18px;
    border: 1px dashed rgba(93, 132, 111, 0.35);
    border-radius: 16px;
    text-align: center;
    color: #9bb7a6;
    font-size: 12px;
    background: rgba(7, 19, 13, 0.55);
  }

  .chart-caption,
  .legend-caption {
    margin-top: 10px;
    font-size: 11px;
    color: #7c9c88;
  }

  .sub-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .subheading {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 8px;
  }

  .summary-callout {
    padding: 14px;
    border-radius: 14px;
    background: rgba(7, 19, 13, 0.72);
    border: 1px solid rgba(93, 132, 111, 0.24);
    font-size: 12px;
    line-height: 1.6;
    color: #cce3d5;
    margin-bottom: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th, td {
    padding: 10px 8px;
    text-align: left;
    font-size: 12px;
    border-bottom: 1px solid rgba(93, 132, 111, 0.2);
    vertical-align: top;
  }

  th {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #8cab99;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    font-size: 10px;
    color: #789481;
    margin-top: 18px;
  }
`;

export type MonthlyReportContentProps = MonthlyReportDocumentProps;

function ReportCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="section-title">{title}</h2>
      <p className="section-description">{description}</p>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

function CurrencyLegendList({ items }: { items: Array<{ name: string; amount: number }> }) {
  return (
    <div className="legend-list">
      {items.map((item, index) => (
        <div key={`${item.name}-${index}`} className="legend-item">
          <div className="legend-name">
            <span className="swatch" style={{ backgroundColor: DASHBOARD_CHART_COLORS[index % DASHBOARD_CHART_COLORS.length] }} />
            <span>{item.name}</span>
          </div>
          <span className="list-value neutral">{formatCurrency(item.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ items, label }: { items: Array<{ name: string; amount: number }>; label: string }) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  let offset = 0;

  if (total <= 0) {
    return <EmptyState>No chart data available.</EmptyState>;
  }

  return (
    <div>
      <svg width="100%" viewBox="0 0 220 220" role="img" aria-label={label}>
        <circle cx="110" cy="110" r={radius} fill="none" stroke="rgba(124, 156, 136, 0.18)" strokeWidth="26" />
        <g transform="rotate(-90 110 110)">
          {items.map((item, index) => {
            const segmentLength = (item.amount / total) * circumference;
            const circle = (
              <circle
                key={`${item.name}-${index}`}
                cx="110"
                cy="110"
                r={radius}
                fill="none"
                stroke={DASHBOARD_CHART_COLORS[index % DASHBOARD_CHART_COLORS.length]}
                strokeWidth="26"
                strokeDasharray={`${segmentLength} ${circumference}`}
                strokeDashoffset={-offset}
              />
            );
            offset += segmentLength;
            return circle;
          })}
        </g>
        <text x="110" y="102" textAnchor="middle" fill="#8cab99" fontSize="12">
          Total
        </text>
        <text x="110" y="122" textAnchor="middle" fill="#f4fbf7" fontSize="16" fontWeight="700">
          {formatCurrency(total)}
        </text>
      </svg>
      <div className="chart-caption">{items.length} category slices shown for {label.toLowerCase()}.</div>
    </div>
  );
}

function HorizontalBarChart({ items, label }: { items: Array<{ merchant: string; amount: number }>; label: string }) {
  if (items.length === 0) {
    return <EmptyState>No merchant chart data available.</EmptyState>;
  }

  const chartItems = items.slice(0, 8);
  const maxValue = Math.max(...chartItems.map((item) => item.amount), 1);
  const rowHeight = 34;
  const chartHeight = chartItems.length * rowHeight + 18;
  const labelWidth = 120;
  const barWidth = 360;
  const valueX = labelWidth + barWidth + 14;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 560 ${chartHeight}`} role="img" aria-label={label}>
        {chartItems.map((item, index) => {
          const y = index * rowHeight + 10;
          const width = Math.max(8, (item.amount / maxValue) * barWidth);
          return (
            <g key={`${item.merchant}-${index}`}>
              <text x="0" y={y + 13} fill="#9bb7a6" fontSize="11">{truncateLabel(item.merchant, 18)}</text>
              <rect x={labelWidth} y={y} width={barWidth} height="16" rx="8" fill="rgba(124, 156, 136, 0.15)" />
              <rect x={labelWidth} y={y} width={width} height="16" rx="8" fill="#34d399" />
              <text x={valueX} y={y + 13} fill="#f4fbf7" fontSize="11">{formatCurrency(item.amount)}</text>
            </g>
          );
        })}
      </svg>
      <div className="chart-caption">Top {chartItems.length} merchants ranked by spend for the selected month.</div>
    </div>
  );
}

function TrendLineChart({ data }: { data: DashboardAnalytics["monthly_trend"] }) {
  if (data.length === 0) {
    return <EmptyState>No monthly trend data available.</EmptyState>;
  }

  const width = 640;
  const height = 260;
  const padding = { top: 18, right: 24, bottom: 34, left: 36 };
  const usableWidth = width - padding.left - padding.right;
  const usableHeight = height - padding.top - padding.bottom;
  const allValues = data.flatMap((item) => [item.money_out, item.money_in, item.net, 0]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const range = Math.max(1, maxValue - minValue);

  const getX = (index: number) => padding.left + (data.length === 1 ? usableWidth / 2 : (index / (data.length - 1)) * usableWidth);
  const getY = (value: number) => padding.top + usableHeight - ((value - minValue) / range) * usableHeight;
  const buildPolyline = (values: number[]) => values.map((value, index) => `${getX(index)},${getY(value)}`).join(" ");
  const gridLines = 4;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Rolling 12 month cashflow trend">
        {Array.from({ length: gridLines + 1 }).map((_, index) => {
          const y = padding.top + (usableHeight / gridLines) * index;
          return <line key={index} x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="rgba(124, 156, 136, 0.18)" strokeDasharray="4 4" />;
        })}
        <line x1={padding.left} y1={getY(0)} x2={width - padding.right} y2={getY(0)} stroke="rgba(124, 156, 136, 0.22)" />
        <polyline fill="none" stroke="#f87171" strokeWidth="3" points={buildPolyline(data.map((item) => item.money_out))} />
        <polyline fill="none" stroke="#34d399" strokeWidth="3" points={buildPolyline(data.map((item) => item.money_in))} />
        <polyline fill="none" stroke="#86efac" strokeWidth="3" points={buildPolyline(data.map((item) => item.net))} />
        {data.map((item, index) => (
          <g key={item.month}>
            <circle cx={getX(index)} cy={getY(item.money_out)} r="3" fill="#f87171" />
            <circle cx={getX(index)} cy={getY(item.money_in)} r="3" fill="#34d399" />
            <circle cx={getX(index)} cy={getY(item.net)} r="3" fill="#86efac" />
            <text x={getX(index)} y={height - 10} textAnchor="middle" fill="#8cab99" fontSize="10">{trendTickLabel(item.month)}</text>
          </g>
        ))}
      </svg>
      <div className="legend-list" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 8 } as CSSProperties}>
        <div className="legend-item"><div className="legend-name"><span className="swatch" style={{ backgroundColor: "#f87171" }} />Money out</div></div>
        <div className="legend-item"><div className="legend-name"><span className="swatch" style={{ backgroundColor: "#34d399" }} />Money in</div></div>
        <div className="legend-item"><div className="legend-name"><span className="swatch" style={{ backgroundColor: "#86efac" }} />Net</div></div>
      </div>
    </div>
  );
}

function TransactionList({
  items,
  emptyMessage,
  highlightMajor,
}: {
  items: DashboardAnalytics["recurring_transactions"] | DashboardAnalytics["major_one_time_purchases"];
  emptyMessage: string;
  highlightMajor?: boolean;
}) {
  if (items.length === 0) {
    return <EmptyState>{emptyMessage}</EmptyState>;
  }

  return (
    <div className="stack-list">
      {items.map((expense) => (
        <div key={expense.id} className="list-item">
          <div className="list-copy">
            <div className="list-title">{expense.merchant}</div>
            <div className="list-subtitle">
              {expense.category_name} · {formatDate(expense.expense_date)} · {transactionTypeLabel(expense.transaction_type)} · {transactionCadenceLabel(expense.cadence)}
            </div>
          </div>
          <div className={`list-value ${highlightMajor || expense.transaction_type !== "credit" ? "negative" : "positive"}`}>
            {formatSignedCurrency(expense.amount, expense.transaction_type, expense.currency)}
          </div>
        </div>
      ))}
    </div>
  );
}

function IncomeSourcesList({ items }: { items: DashboardAnalytics["top_income_sources"] }) {
  if (items.length === 0) {
    return <EmptyState>No income sources recorded for this month.</EmptyState>;
  }

  return (
    <div className="stack-list">
      {items.map((source) => (
        <div key={source.merchant} className="list-item">
          <div className="list-title">{source.merchant}</div>
          <div className="list-value positive">{formatCurrency(source.amount)}</div>
        </div>
      ))}
    </div>
  );
}

function GroceryInsights({ analytics }: { analytics: DashboardAnalytics }) {
  if (analytics.grocery_insights.item_count === 0) {
    return <EmptyState>No itemized grocery receipts were available for this month.</EmptyState>;
  }

  return (
    <div>
      <div className="summary-callout">{analytics.grocery_insights.summary}</div>
      <div className="sub-grid">
        <div>
          <div className="subheading">Top grocery subcategories</div>
          <div className="stack-list">
            {analytics.grocery_insights.top_subcategories.map((item) => (
              <div key={item.name} className="insight-row">
                <div className="list-copy">
                  <div className="list-title">{item.name}</div>
                  <div className="list-subtitle">{item.item_count} items</div>
                </div>
                <div className="list-value neutral">{formatCurrency(item.amount)}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="subheading">Lowest-spend grocery subcategories</div>
          <div className="stack-list">
            {analytics.grocery_insights.least_subcategories.map((item) => (
              <div key={item.name} className="insight-row">
                <div className="list-copy">
                  <div className="list-title">{item.name}</div>
                  <div className="list-subtitle">{item.item_count} items</div>
                </div>
                <div className="list-value neutral">{formatCurrency(item.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="legend-item" style={{ marginTop: 12 } as CSSProperties}>
        <div className="legend-name">
          <span>Itemized grocery spend</span>
        </div>
        <span className="list-value neutral">{formatCurrency(analytics.grocery_insights.total_itemized_spend)}</span>
      </div>
    </div>
  );
}

function BudgetsTable({ budgets, month }: { budgets: DashboardAnalytics["budgets"]; month: string }) {
  if (budgets.length === 0) {
    return <EmptyState>No budgets configured for {monthLabel(month)}.</EmptyState>;
  }

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Budget</th>
            <th>Category</th>
            <th>Target</th>
            <th>Actual</th>
            <th>Remaining</th>
          </tr>
        </thead>
        <tbody>
          {budgets.map((budget) => (
            <tr key={budget.id}>
              <td>{budget.name}</td>
              <td className="muted">{budget.category_name ?? "Overall"}</td>
              <td>{formatCurrency(budget.amount, budget.currency)}</td>
              <td>{formatCurrency(budget.actual, budget.currency)}</td>
              <td className={budget.remaining < 0 ? "negative" : "positive"}>{formatCurrency(budget.remaining, budget.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-note">Remaining values below zero indicate categories that exceeded the configured budget for the reporting month.</div>
    </div>
  );
}

function truncateLabel(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function trendTickLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-GB", { month: "short" });
}

export function MonthlyReportContent({ userEmail, userName, reportMonth, generatedAt, analytics }: MonthlyReportContentProps) {
  const displayName = userName?.trim() || userEmail;
  const summaryStats = getDashboardSummaryStats(analytics);

  return (
    <main className="page">
      <header className="header">
        <div>
          <div className="brand">SpendHound</div>
          <h1>Monthly dashboard report</h1>
          <p className="lede">
            A print-friendly monthly summary of cashflow, category spend, merchant concentration, recurring activity, grocery receipt insights, and budget performance.
          </p>
        </div>
        <aside className="meta-card">
          <div className="meta-grid">
            <div>
              <div className="meta-label">Customer</div>
              <div className="meta-value">{displayName}</div>
            </div>
            <div>
              <div className="meta-label">Email</div>
              <div className="meta-value">{userEmail}</div>
            </div>
            <div>
              <div className="meta-label">Report month</div>
              <div className="meta-value">{monthLabel(reportMonth)}</div>
            </div>
            <div>
              <div className="meta-label">Generated</div>
              <div className="meta-value">{new Date(generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} UTC</div>
            </div>
          </div>
        </aside>
      </header>

      <section className="summary-grid">
        {summaryStats.map((stat) => (
          <div key={stat.label} className="card stat-card">
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">{stat.value}</div>
          </div>
        ))}
      </section>

      <section className="two-column-grid">
        <ReportCard title="Spend by category" description="Where money out went during the month, using the same analytics source as the dashboard.">
          {analytics.spend_by_category.length === 0 ? (
            <EmptyState>No expenses were recorded for this month.</EmptyState>
          ) : (
            <div className="chart-layout">
              <DonutChart items={analytics.spend_by_category} label="Spend by category" />
              <CurrencyLegendList items={analytics.spend_by_category} />
            </div>
          )}
        </ReportCard>

        <ReportCard title="Top spending merchants" description="Merchants contributing the most money-out volume during the month.">
          <HorizontalBarChart items={analytics.top_merchants} label="Top spending merchants" />
        </ReportCard>
      </section>

      <section className="two-column-grid">
        <ReportCard title="Money in by category" description="Income and credit inflows, grouped by category for the selected month.">
          {analytics.income_by_category.length === 0 ? (
            <EmptyState>No income transactions were recorded for this month.</EmptyState>
          ) : (
            <div className="chart-layout">
              <DonutChart items={analytics.income_by_category} label="Money in by category" />
              <CurrencyLegendList items={analytics.income_by_category} />
            </div>
          )}
        </ReportCard>

        <ReportCard title="Grocery subcategory insights" description="LLM-assisted grouping of itemized grocery receipt lines to highlight higher- and lower-spend subcategories.">
          <GroceryInsights analytics={analytics} />
        </ReportCard>
      </section>

      <ReportCard title="Monthly trend" description="Rolling twelve-month view of money in, money out, and net cashflow.">
        <TrendLineChart data={analytics.monthly_trend} />
      </ReportCard>

      <section className="two-column-grid">
        <ReportCard title="Recurring transactions" description="Transactions that look like repeated bills, subscriptions, salary, or other regular cashflow patterns.">
          <TransactionList items={analytics.recurring_transactions} emptyMessage="No recurring patterns were detected for this month." />
        </ReportCard>

        <ReportCard title="Major one-time purchases" description="Large irregular spending called out separately so major purchases remain visible.">
          <TransactionList items={analytics.major_one_time_purchases} emptyMessage="No major one-time purchases were marked for this month." highlightMajor />
        </ReportCard>
      </section>

      <section className="two-column-grid">
        <ReportCard title="Top income sources" description="Largest money-in sources detected during the month.">
          <IncomeSourcesList items={analytics.top_income_sources} />
        </ReportCard>

        <ReportCard title="Budget vs actual" description="Configured budgets compared against actual spending for the reporting month.">
          <BudgetsTable budgets={analytics.budgets} month={analytics.month} />
        </ReportCard>
      </section>

      <footer className="footer">
        <span>Internal SpendHound monthly report export</span>
        <span>{monthLabel(reportMonth)}</span>
      </footer>
    </main>
  );
}

export function MonthlyReportDocument(props: MonthlyReportDocumentProps) {
  const displayName = props.userName?.trim() || props.userEmail;

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`SpendHound monthly report — ${displayName} — ${monthLabel(props.reportMonth)}`}</title>
        <style>{monthlyReportStyles}</style>
      </head>
      <body>
        <MonthlyReportContent {...props} />
      </body>
    </html>
  );
}
