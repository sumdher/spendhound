const FX_STORAGE_KEY = "spendhound_fx_rates";

const DEFAULT_RATES: Record<string, number> = {
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

/** Returns stored rates, falling back to hardcoded defaults. */
export function getStoredRates(): Record<string, number> {
  return readStoredData()?.rates ?? { ...DEFAULT_RATES };
}

/** Returns ISO timestamp of last successful update, or null if never updated. */
export function getStoredRatesUpdatedAt(): string | null {
  return readStoredData()?.updatedAt ?? null;
}

/**
 * Fetches live rates from the Frankfurter ECB API for the given currencies
 * (only non-EUR ones), stores them in localStorage, and returns the new rates.
 * On any network/parse error, returns the currently stored rates gracefully.
 */
export async function fetchAndStoreRates(currencies: string[]): Promise<Record<string, number>> {
  const nonEur = currencies.filter((c) => c !== "EUR" && /^[A-Z]{3}$/.test(c));
  if (nonEur.length === 0) return getStoredRates();

  const symbols = nonEur.join(",");
  const res = await fetch(`https://api.frankfurter.app/latest?base=EUR&symbols=${symbols}`);
  if (!res.ok) throw new Error(`Frankfurter API returned ${res.status}`);
  const json = await res.json() as { base: string; rates: Record<string, number> };
  const newRates: Record<string, number> = json.rates;

  const stored: StoredFxData = { rates: newRates, updatedAt: new Date().toISOString() };
  localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(stored));
  return newRates;
}

/**
 * Converts `amount` in `currency` to EUR using the provided rate map.
 * Rates are expressed as "1 EUR = N <currency>", so EUR amount = native / rate.
 * Returns the amount unchanged if currency is EUR or the rate is not found.
 */
export function convertToEur(amount: number, currency: string, rates: Record<string, number>): number {
  if (!currency || currency === "EUR") return amount;
  const rate = rates[currency];
  if (!rate) return amount;
  return amount / rate;
}
