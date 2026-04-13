import { headers } from "next/headers";
import { MonthlyReportContent, monthlyReportStyles } from "@/components/reports/monthly-report-document";
import { assertInternalMonthlyReportHeaders, fetchDashboardAnalyticsForMonthlyReport, monthlyReportRequestSchema } from "@/lib/monthly-report";

export const dynamic = "force-dynamic";

interface InternalMonthlyReportPageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

function getSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InternalMonthlyReportRenderPage({ searchParams }: InternalMonthlyReportPageProps) {
  assertInternalMonthlyReportHeaders(headers());

  const parsed = monthlyReportRequestSchema.parse({
    user_id: getSearchParam(searchParams.user_id),
    user_email: getSearchParam(searchParams.user_email),
    user_name: getSearchParam(searchParams.user_name),
    report_month: getSearchParam(searchParams.report_month),
  });

  const analytics = await fetchDashboardAnalyticsForMonthlyReport(parsed);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`SpendHound monthly report — ${parsed.report_month}`}</title>
        <style>{monthlyReportStyles}</style>
      </head>
      <body>
        <MonthlyReportContent
          analytics={analytics}
          generatedAt={new Date().toISOString()}
          reportMonth={parsed.report_month}
          userEmail={parsed.user_email}
          userName={parsed.user_name}
        />
      </body>
    </html>
  );
}
