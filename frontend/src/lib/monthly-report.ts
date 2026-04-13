import { SignJWT } from "jose";
import { z } from "zod";
import type { DashboardAnalytics } from "@/lib/api";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://backend:8000";

export const INTERNAL_REPORT_TOKEN_HEADER = process.env.MONTHLY_REPORTS_FRONTEND_TOKEN_HEADER ?? "X-SpendHound-Internal-Token";

export const monthlyReportRequestSchema = z.object({
  user_id: z.string().uuid(),
  user_email: z.string().email(),
  user_name: z.string().trim().min(1).optional().nullable(),
  report_month: z.string().regex(/^\d{4}-\d{2}$/),
});

export type MonthlyReportRequest = z.infer<typeof monthlyReportRequestSchema>;

type HeaderReader = Pick<Headers, "get">;

function getBackendJwtSecret(): string {
  const secret = process.env.MONTHLY_REPORTS_BACKEND_JWT_SECRET;
  if (!secret) {
    throw new Error("MONTHLY_REPORTS_BACKEND_JWT_SECRET is not configured");
  }
  return secret;
}

export function assertInternalMonthlyReportHeaders(headers: HeaderReader) {
  const expectedToken = process.env.MONTHLY_REPORTS_FRONTEND_TOKEN;
  if (!expectedToken) {
    throw new Error("MONTHLY_REPORTS_FRONTEND_TOKEN is not configured");
  }

  const receivedToken = headers.get(INTERNAL_REPORT_TOKEN_HEADER);
  if (receivedToken !== expectedToken) {
    const error = new Error("Unauthorized");
    error.name = "UnauthorizedError";
    throw error;
  }
}

export function assertInternalMonthlyReportToken(request: Request) {
  assertInternalMonthlyReportHeaders(request.headers);
}

export async function createMonthlyReportAccessToken(userId: string, userEmail: string): Promise<string> {
  const algorithm = process.env.MONTHLY_REPORTS_BACKEND_JWT_ALGORITHM ?? "HS256";
  const secret = new TextEncoder().encode(getBackendJwtSecret());

  return new SignJWT({ email: userEmail })
    .setProtectedHeader({ alg: algorithm })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);
}

export async function fetchDashboardAnalyticsForMonthlyReport(payload: MonthlyReportRequest): Promise<DashboardAnalytics> {
  const accessToken = await createMonthlyReportAccessToken(payload.user_id, payload.user_email);
  const response = await fetch(`${INTERNAL_API_URL}/api/analytics/dashboard?month=${encodeURIComponent(payload.report_month)}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(detail || `Unable to load dashboard analytics (HTTP ${response.status})`);
  }

  return response.json() as Promise<DashboardAnalytics>;
}
