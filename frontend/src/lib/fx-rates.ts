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
 * Fetches live rates from the Frankfurter ECB API.
 * `currencies` — list of all currencies present in the user's data.
 * `baseCurrency` — the base (default) currency to fetch rates relative to.
 *   Defaults to the user's stored default currency.
 *
 * Only non-base currencies are requested. The resulting rates are stored
 * in localStorage and returned. On network/parse error, throws so callers
 * can surface an error message.
 *
 * Rate semantics stored: "1 baseCurrency = N <otherCurrency>"
 * so: amount_in_base = amount_in_other / rate[other]
 */
export async function fetchAndStoreRates(
  currencies: string[],
  baseCurrency?: string,
): Promise<Record<string, number>> {
  const base = baseCurrency || getDefaultCurrency();
  const nonBase = currencies.filter((c) => c !== base && /^[A-Z]{3}$/.test(c));
  if (nonBase.length === 0) return getStoredRates();

  const symbols = nonBase.join(",");
  const res = await fetch(`https://api.frankfurter.app/latest?base=${base}&symbols=${symbols}`);
  if (!res.ok) throw new Error(`Frankfurter API returned ${res.status}`);
  const json = await res.json() as { base: string; rates: Record<string, number> };
  const newRates: Record<string, number> = json.rates;

  const stored: StoredFxData = { rates: newRates, updatedAt: new Date().toISOString() };
  localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(stored));
  return newRates;
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
