export function formatUsd(units: string) {
  const cents = BigInt(units) / 10_000n;
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `$${whole.toString()}.${frac}`;
}

export function formatInr(paise: string) {
  const value = BigInt(paise);
  const whole = value / 100n;
  const frac = (value % 100n).toString().padStart(2, "0");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₹${grouped}.${frac}`;
}

export function formatRate(paisePerUsd: string) {
  const value = BigInt(paisePerUsd);
  const whole = value / 100n;
  const frac = (value % 100n).toString().padStart(2, "0");
  return `₹${whole}.${frac}`;
}

export const relayerUrl = process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://127.0.0.1:8787";
