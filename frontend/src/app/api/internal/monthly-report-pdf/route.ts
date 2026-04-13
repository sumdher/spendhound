import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { INTERNAL_REPORT_TOKEN_HEADER, assertInternalMonthlyReportToken, monthlyReportRequestSchema } from "@/lib/monthly-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHROMIUM_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
].filter((value): value is string => Boolean(value));

function getChromiumExecutablePath() {
  const executablePath = CHROMIUM_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    throw new Error("No Chromium executable found. Set PUPPETEER_EXECUTABLE_PATH or install Chromium in the frontend runtime.");
  }
  return executablePath;
}

export async function POST(request: Request) {
  try {
    assertInternalMonthlyReportToken(request);
  } catch (error) {
    if (error instanceof Error && error.name === "UnauthorizedError") {
      return Response.json({ detail: "Unauthorized" }, { status: 401 });
    }

    return Response.json({ detail: error instanceof Error ? error.message : "Monthly report authentication is misconfigured" }, { status: 500 });
  }

  const json = await request.json().catch(() => null);
  const parsedBody = monthlyReportRequestSchema.safeParse(json);
  if (!parsedBody.success) {
    return Response.json({ detail: "Invalid monthly report payload", errors: parsedBody.error.flatten() }, { status: 400 });
  }

  const payload = parsedBody.data;

  try {
    const browser = await puppeteer.launch({
      executablePath: getChromiumExecutablePath(),
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=medium"],
    });

    try {
      const page = await browser.newPage();
      const internalToken = request.headers.get(INTERNAL_REPORT_TOKEN_HEADER);
      if (internalToken) {
        await page.setExtraHTTPHeaders({
          [INTERNAL_REPORT_TOKEN_HEADER]: internalToken,
        });
      }

      await page.setViewport({ width: 1440, height: 2200, deviceScaleFactor: 1 });
      await page.emulateMediaType("screen");
      const renderUrl = new URL("/internal/monthly-report/render", request.url);
      renderUrl.searchParams.set("user_id", payload.user_id);
      renderUrl.searchParams.set("user_email", payload.user_email);
      if (payload.user_name) renderUrl.searchParams.set("user_name", payload.user_name);
      renderUrl.searchParams.set("report_month", payload.report_month);

      const response = await page.goto(renderUrl.toString(), { waitUntil: "networkidle0" });
      if (!response?.ok()) {
        const status = response?.status() ?? 500;
        throw new Error(`Unable to render monthly report page (HTTP ${status})`);
      }

      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "0mm",
          right: "0mm",
          bottom: "0mm",
          left: "0mm",
        },
        preferCSSPageSize: true,
      });

      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `inline; filename="spendhound-monthly-report-${payload.report_month}-${payload.user_id}.pdf"`,
          "Content-Type": "application/pdf",
        },
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    return Response.json({ detail: error instanceof Error ? error.message : "Unable to generate monthly report PDF" }, { status: 502 });
  }
}
