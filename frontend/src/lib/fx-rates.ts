const FX_STORAGE_KEY = "spendhound_fx_rates";
const FX_DEFAULT_CURRENCY_KEY = "spendhound_default_currency";

/** The hardcoded system fallback — EUR is always the platform default-of-defaults. */
const SYSTEM_DEFAULT_CURRENCY = "EUR";

/**
 * Fallback rates expressed as "1 EUR = N <currency>".
 * These are only used until the user fetches live rates.
 * If the user has set a non-EUR default currency they should click
 * "Update rates" once to get accurate live rates for their base currency.
 */
const EUR_FALLBACK_RATES: Record<string, number> = {
  INR: 110.14,
  USD: 1.18,
  AED: 4.33,
};

interface StoredFxData {
  rates: Record<string, number>;
  updatedAt: string;
}

function readStoredData(): StoredFxData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FX_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredFxData;
    if (parsed.rates && typeof parsed.rates === "object" && Object.keys(parsed.rates).length > 0) {
      return parsed;
    }
  } catch {
    // ignore localStorage / JSON errors
  }
  return null;
}

/** Returns stored exchange rates, falling back to hardcoded EUR-centric defaults. */
export function getStoredRates(): Record<string, number> {
  return readStoredData()?.rates ?? { ...EUR_FALLBACK_RATES };
}

/** Returns ISO timestamp of last successful rate update, or null if never updated. */
export function getStoredRatesUpdatedAt(): string | null {
  return readStoredData()?.updatedAt ?? null;
}

/**
 * Returns the user's chosen default/base currency (stored in localStorage).
 * Falls back to EUR when not set.
 */
export function getDefaultCurrency(): string {
  if (typeof window === "undefined") return SYSTEM_DEFAULT_CURRENCY;
  return localStorage.getItem(FX_DEFAULT_CURRENCY_KEY) || SYSTEM_DEFAULT_CURRENCY;
}

/**
 * Persists the user's chosen default/base currency to localStorage.
 * Passing EUR (or empty) removes the key so the system default takes over.
 */
export function setDefaultCurrency(currency: string): void {
  if (typeof window === "undefined") return;
  if (!currency || currency === SYSTEM_DEFAULT_CURRENCY) {
    localStorage.removeItem(FX_DEFAULT_CURRENCY_KEY);
  } else {
    localStorage.setItem(FX_DEFAULT_CURRENCY_KEY, currency.toUpperCase().trim());
  }
}

/**
 * Try fawazahmed0/currency-api served from jsDelivr CDN (primary) and
 * Cloudflare Pages mirror (secondary). Both are free, CDN-backed, no rate
 * limits, and cover 170+ currencies including INR and AED.
 *
 * Response shape: { date: "YYYY-MM-DD", "<base_lower>": { "<symbol_lower>": rate, ... } }
 * Rates are already expressed as "1 base = N symbol".
 */
async function fetchFromFawazahmed(
  base: string,
  symbols: string[],
): Promise<Record<string, number> | null> {
  const baseLower = base.toLowerCase();
  const endpoints = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${baseLower}.json`,
    `https://latest.currency-api.pages.dev/v1/currencies/${baseLower}.json`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json() as Record<string, unknown>;
      const allRates = json[baseLower] as Record<string, number> | undefined;
      if (!allRates || typeof allRates !== "object") continue;

      const rates: Record<string, number> = {};
      for (const symbol of symbols) {
        const rate = allRates[symbol.toLowerCase()];
        if (typeof rate === "number" && rate > 0) {
          rates[symbol.toUpperCase()] = rate;
        }
      }
      if (Object.keys(rates).length > 0) return rates;
    } catch {
      // try next endpoint
    }
  }
  return null;
}

/**
 * Try the Frankfurter ECB API as a last resort.
 * Slower, community-maintained, only ECB-tracked currencies.
 */
async function fetchFromFrankfurter(
  base: string,
  symbols: string[],
): Promise<Record<string, number> | null> {
  try {
    const url = `https://api.frankfurter.app/latest?base=${base}&symbols=${symbols.join(",")}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json() as { base: string; rates: Record<string, number> };
    return json.rates && Object.keys(json.rates).length > 0 ? json.rates : null;
  } catch {
    return null;
  }
}

/**
 * Fetches live rates for `currencies` relative to `baseCurrency`.
 * Tries three sources in order:
 *   1. fawazahmed0 / jsDelivr CDN (170+ currencies, no rate limit)
 *   2. fawazahmed0 / Cloudflare Pages mirror
 *   3. Frankfurter ECB API
 *
 * Rate semantics stored: "1 baseCurrency = N <otherCurrency>"
 * so: amount_in_base = amount_in_other / rate[other]
 *
 * Throws only when all three sources fail so the caller can show an error.
 */
export async function fetchAndStoreRates(
  currencies: string[],
  baseCurrency?: string,
): Promise<Record<string, number>> {
  const base = baseCurrency || getDefaultCurrency();
  const nonBase = currencies.filter((c) => c !== base && /^[A-Z]{3}$/.test(c));
  if (nonBase.length === 0) return getStoredRates();

  const rates =
    (await fetchFromFawazahmed(base, nonBase)) ??
    (await fetchFromFrankfurter(base, nonBase));

  if (!rates) {
    throw new Error("Could not reach any exchange rate provider. Check your connection and try again.");
  }

  const stored: StoredFxData = { rates, updatedAt: new Date().toISOString() };
  localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(stored));
  return rates;
}

/**
 * Converts `amount` in `currency` to `baseCurrency` using the provided rate map.
 *
 * Rate semantics: rates[currency] = how many `currency` units equal 1 `baseCurrency`.
 * So: base_amount = native_amount / rate
 *
 * Returns `amount` unchanged when:
 * - currency equals baseCurrency (no conversion needed)
 * - currency is missing/empty
 * - the rate for currency is not found in the map (graceful degradation)
 */
export function convertToBase(
  amount: number,
  currency: string,
  baseCurrency: string,
  rates: Record<string, number>,
): number {
  if (!currency || currency === baseCurrency) return amount;
  const rate = rates[currency];
  if (!rate) return amount;
  return amount / rate;
}

/**
 * Backward-compatible alias: converts to EUR specifically.
 * New code should prefer `convertToBase` with an explicit baseCurrency.
 */
export function convertToEur(amount: number, currency: string, rates: Record<string, number>): number {
  return convertToBase(amount, currency, "EUR", rates);
}
