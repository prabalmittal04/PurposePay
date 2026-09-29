export const FEE_BPS = 50n;
export const USD_SCALE = 1_000_000n;

export function quoteFromGross(grossUsd6: bigint, ratePaisePerUsd: bigint) {
  const feeUsd6 = (grossUsd6 * FEE_BPS) / 10_000n;
  const netUsd6 = grossUsd6 - feeUsd6;
  const netInrPaise = (netUsd6 * ratePaisePerUsd) / USD_SCALE;
  return { grossUsd6, feeUsd6, netUsd6, netInrPaise, feeBps: FEE_BPS, ratePaisePerUsd };
}
