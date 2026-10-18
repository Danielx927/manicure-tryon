export type Price = { amount: number; currency: string };

export const CURRENCIES = ["USD", "SGD", "MYR", "PHP", "IDR", "HKD", "CNY", "JPY", "AUD", "EUR", "GBP", "CAD"] as const;
export const DEFAULT_CURRENCY = "USD";

export function formatPrice(price: Price): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(price.amount);
  } catch {
    return `${price.currency} ${price.amount.toFixed(2)}`;
  }
}

/**
 * Validates a price typed by an admin. Returns the price, null for "no price"
 * (empty amount), or an error message.
 */
export function parsePrice(amountRaw: unknown, currencyRaw: unknown): Price | null | { error: string } {
  const text = typeof amountRaw === "number" ? String(amountRaw) : typeof amountRaw === "string" ? amountRaw.trim() : "";
  if (!text) return null;
  const currency = typeof currencyRaw === "string" && currencyRaw ? currencyRaw : DEFAULT_CURRENCY;
  if (!(CURRENCIES as readonly string[]).includes(currency)) return { error: "Please pick a currency from the list." };
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return { error: "Enter the price as a number, like 12 or 12.50." };
  return { amount: Number(text), currency };
}
