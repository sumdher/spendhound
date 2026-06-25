import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — SpendHound",
  description: "How SpendHound collects, uses, and protects your personal data. GDPR-compliant.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to SpendHound
          </Link>
          <h1 className="mt-6 text-4xl font-bold">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: <time dateTime="2026-06-20">20 June 2026</time>
          </p>
        </div>

        <div className="space-y-10 text-sm leading-relaxed text-foreground/90">

          {/* 1 — Data Controller */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">1. Data Controller</h2>
            <p>
              SpendHound is operated by <strong>Sudheer Raj S.V.</strong>, an individual based in
              Milan, Italy (EU). For all data protection enquiries, contact:
            </p>
            <p className="mt-3 rounded-lg border border-border bg-card px-4 py-3 font-mono text-sm">
              srsudhir31@gmail.com
            </p>
            <p className="mt-3 text-muted-foreground text-xs">
              As the data controller is based in Italy (EU), the competent supervisory authority
              is the <strong>Garante per la protezione dei dati personali</strong> (Garante). You
              may also contact your own national data protection authority if you believe your
              rights under the GDPR have been infringed.
            </p>
          </section>

          {/* 2 — Data We Collect */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">2. Personal Data We Collect</h2>
            <p className="mb-3">We collect and store the following categories of personal data:</p>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Category</th>
                  <th className="pb-2 pr-4 font-medium">Examples</th>
                  <th className="pb-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                <tr>
                  <td className="py-2 pr-4 font-medium">Identity</td>
                  <td className="py-2 pr-4">Name, email address, profile picture URL</td>
                  <td className="py-2">Google OAuth</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">Financial records</td>
                  <td className="py-2 pr-4">Expenses, merchant names, amounts, dates, categories, budgets</td>
                  <td className="py-2">You (manual or from receipts)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">Uploaded files</td>
                  <td className="py-2 pr-4">Receipt images, bank statement PDFs</td>
                  <td className="py-2">You</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">Chat history</td>
                  <td className="py-2 pr-4">Messages exchanged with the AI expense assistant</td>
                  <td className="py-2">You</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-medium">Account metadata</td>
                  <td className="py-2 pr-4">Account creation date, account status</td>
                  <td className="py-2">Generated automatically</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-3 text-muted-foreground text-xs">
              We do <strong>not</strong> collect passwords (login is via Google OAuth only). We do
              not use analytics trackers, advertising networks, or third-party cookies.
            </p>
          </section>

          {/* 3 — Legal Basis */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">3. Legal Basis for Processing (GDPR Art. 6)</h2>
            <ul className="space-y-2 list-disc list-inside text-foreground/90">
              <li>
                <strong>Performance of a contract</strong> (Art. 6(1)(b)): We process your identity
                and financial data to provide the expense-tracking service you signed up for.
              </li>
              <li>
                <strong>Legitimate interests</strong> (Art. 6(1)(f)): We process minimal account
                metadata to prevent abuse and protect the security of the service. This interest
                does not override your fundamental rights.
              </li>
            </ul>
          </section>

          {/* 4 — Third Parties */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">4. Third-Party Processors</h2>
            <p className="mb-3">
              We share data with the following sub-processors only to the extent necessary to
              deliver the service:
            </p>
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-medium">Google LLC — Authentication</p>
                <p className="text-xs text-muted-foreground mt-1">
                  We use Google OAuth 2.0 so you can sign in without a password. Google receives
                  your login request and returns your name, email, and profile picture. Governed by
                  Google&apos;s Privacy Policy.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-medium">Resend — Email delivery</p>
                <p className="text-xs text-muted-foreground mt-1">
                  If you have opted in to monthly PDF reports, your email address and report
                  content are transmitted to Resend for delivery. No data is retained beyond
                  delivery. Governed by Resend&apos;s Privacy Policy.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-medium">Sentry — Error monitoring</p>
                <p className="text-xs text-muted-foreground mt-1">
                  We use Sentry to capture application errors and exceptions. Error reports contain
                  stack traces, request URLs, and an anonymous user identifier (a random ID, never
                  your email or financial data). Data is processed on Sentry&apos;s EU infrastructure
                  (<strong>ingest.de.sentry.io</strong>). Governed by Sentry&apos;s Privacy Policy.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-medium">LLM Providers — Receipt &amp; statement parsing</p>
                <p className="text-xs text-muted-foreground mt-1">
                  When you upload a receipt or bank statement for automatic extraction, the file
                  content (image or text) is sent to an AI language model provider for parsing.
                  The active provider is configured by the server administrator and may be one of:
                  <strong> Anthropic</strong>, <strong>OpenAI</strong>, or{" "}
                  <strong>Nebius</strong>. If the server is configured to use{" "}
                  <strong>Ollama</strong> (local model), no data leaves the server. Each provider
                  is governed by its own privacy policy and data-processing terms. Parsed results
                  are not stored by the provider beyond the duration of the API request.
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              We do not sell, rent, or trade your personal data to any third party for marketing
              purposes.
            </p>
          </section>

          {/* 5 — Data Storage & Retention */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">5. Data Storage &amp; Retention</h2>
            <ul className="space-y-2 list-disc list-inside text-foreground/90">
              <li>
                <strong>Server location</strong>: All data is stored on servers located in the
                European Economic Area (EEA).
              </li>
              <li>
                <strong>Retention period</strong>: Your data is retained for as long as your
                account is active. When you delete your account, all personal data (database
                records and uploaded files) is permanently and irreversibly erased within 24 hours.
              </li>
              <li>
                <strong>Security</strong>: Data is encrypted in transit (TLS/HTTPS). API keys you
                provide for custom AI models are encrypted at rest using AES-256 before storage.
              </li>
            </ul>
          </section>

          {/* 6 — Cookies */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">6. Cookies</h2>
            <p>
              SpendHound uses a single, strictly necessary <strong>session cookie</strong> to keep
              you signed in (set by NextAuth.js, HTTP-only, Secure). No tracking cookies,
              advertising cookies, or analytics cookies are used. No cookie consent banner is
              required for strictly necessary cookies under ePrivacy rules.
            </p>
          </section>

          {/* 7 — Your Rights */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">7. Your Rights Under the GDPR</h2>
            <p className="mb-3">
              If you are located in the EEA, you have the following rights regarding your personal
              data:
            </p>
            <div className="space-y-2">
              {[
                ["Right of access (Art. 15)", "Request a copy of all personal data we hold about you."],
                ["Right to rectification (Art. 16)", "Ask us to correct inaccurate or incomplete data."],
                ["Right to erasure (Art. 17)", "Delete your account and all associated data permanently via Settings → My Account → Delete Account, or by emailing us."],
                ["Right to restrict processing (Art. 18)", "Request that we temporarily stop processing your data while a dispute is resolved."],
                ["Right to data portability (Art. 20)", "Request a machine-readable copy of your expense and chat data by emailing us."],
                ["Right to object (Art. 21)", "Object to processing based on legitimate interests."],
                ["Right to lodge a complaint", "Contact your national data protection authority if you believe your rights have been violated."],
              ].map(([right, desc]) => (
                <div key={right} className="rounded-lg border border-border bg-card/50 px-4 py-3">
                  <p className="font-medium text-sm">{right}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              To exercise any of the above rights (other than erasure, which you can do directly
              in the app), email{" "}
              <a href="mailto:srsudhir31@gmail.com" className="underline hover:text-foreground">
                srsudhir31@gmail.com
              </a>
              . We will respond within 30 days.
            </p>
          </section>

          {/* 8 — International Transfers */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">8. International Data Transfers</h2>
            <p>
              Your data is stored in the EEA and the data controller (Sudheer Raj S.V.) is based
              in Italy (EU), so no cross-border transfer outside the EEA occurs on our side.
              Google and Resend may transfer data internationally in accordance with their own
              approved transfer mechanisms (Standard Contractual Clauses or adequacy decisions).
            </p>
          </section>

          {/* 9 — Children */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">9. Children&apos;s Privacy</h2>
            <p>
              SpendHound is not directed at children under 16. We do not knowingly collect personal
              data from children. If you believe a child has provided us with personal data, please
              contact us and we will delete it promptly.
            </p>
          </section>

          {/* 10 — Changes */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Material changes will be
              communicated via the email address associated with your account. The &quot;Last
              updated&quot; date at the top of this page always reflects the most recent revision.
            </p>
          </section>

          {/* 11 — Contact */}
          <section>
            <h2 className="mb-3 text-xl font-semibold text-foreground">11. Contact</h2>
            <p>
              For any privacy-related questions or to exercise your rights:
            </p>
            <p className="mt-3 rounded-lg border border-border bg-card px-4 py-3 font-mono text-sm">
              srsudhir31@gmail.com
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 border-t border-border pt-8 text-center text-xs text-muted-foreground space-y-2">
          <p>SpendHound — personal expense tracker</p>
          <p>
            <Link href="/login" className="hover:text-foreground underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
