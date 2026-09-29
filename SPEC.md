# PurposePay specification

Judges should treat this file as the rulebook the code follows. Local demo only. No production settlement claim.

## Parties

Fictional. No real institution and no real bank VPA suffix.

- Sender: `arun@purposepay.demo`
- Beneficiary (who the money is for, not the tuition payee): `priya@purposepay.demo`
- Authorized school: Harbourview Institute, `fees@harbourview.demo`, category `SCHOOL`
- Other school, used only by the view preview: Northgate Academy, `fees@northgate.demo`, category `SCHOOL`
- Hospital: Citycare Clinic, `billing@citycare.demo`, category `HOSPITAL`
- Unregistered: `friend@purposepay.demo`

On-chain identity for a VPA is `keccak256` of its UTF-8 bytes. That commitment authorizes a payee. It is not an anonymity claim. The audit export does not use it. The export uses `HMAC-SHA256(AUDIT_HMAC_KEY, "vpa:" + vpa)`.

## Quote

The sender does not supply a rate. `feeBps` is the constant `50`.

- Only the owner may call `setQuote(ratePaisePerUsd, validUntil)`.
- `createRemittance` reads the stored quote. If `block.timestamp > validUntil`, it reverts `QuoteExpired`.
- `quoteId = keccak256(abi.encode(ratePaisePerUsd, validUntil, feeBps))`, computed in the contract.
- Net INR is computed in the contract. `reservePayout` and `confirmPayout` take no amount.

Seed: `ratePaisePerUsd = 8350`, gross `200_000_000` (6 decimal USD).

- `feeUsd6 = grossUsd6 * 50 / 10_000` (floor)
- `netUsd6 = grossUsd6 - feeUsd6`
- `netInrPaise = netUsd6 * ratePaisePerUsd / 1_000_000` (floor)

Seed result: fee `1_000_000` ($1.00), net `199_000_000` ($199.00), INR `1_661_650` paise (₹16,616.50), remainder 0.

The SWIFT column in the UI is an illustrative comparison. It is not a quote and it is not stored.

## Payee policy

Checked in this order. The first failure is the reason.

1. Commitment missing from the registry → `UnregisteredPayee`
2. Category does not match the purpose → `CategoryMismatch`
3. Commitment is not the sender-approved payee stored on this remittance → `PayeeNotAuthorized`

`TUITION` requires `SCHOOL`. `MEDICAL` requires `HOSPITAL`. `RENT` requires `LANDLORD`. `GENERAL` accepts any registered category.

`createRemittance(beneficiaryCommitment, authorizedPayeeCommitment, purpose, grossUsd6)` runs this check before it takes tokens. These are reverting transactions:

- `friend@purposepay.demo` → `UnregisteredPayee`
- `billing@citycare.demo` with `TUITION` → `CategoryMismatch`

`reservePayout(id)` takes no payee and no amount. It runs the same check again on the stored payee, because the registry can change, and it rejects an expired quote.

`previewPayout(id, payeeCommitment)` is a view. Northgate on a Harbourview tuition remittance returns `PayeeNotAuthorized`. The UI labels that row **policy preview (view call)**. No payout function accepts a payee.

## States

`OPEN → PAYOUT_PENDING → SETTLED`

`PAYOUT_PENDING → PAYOUT_UNKNOWN → SETTLED` on a later confirm for the same `payoutId`.

`OPEN → REFUNDED` only after expiry, by the sender, for the full gross USD.

- `payoutId = keccak256(abi.encode(block.chainid, address(vault), id))`
- Adapter `CONFIRMED` → `confirmPayout(id, payoutId)` → `SETTLED`. The event amount is the stored `netInrPaise`. The same call transfers `grossUsd6` of MockUSD to the stored `treasury` address. `feeUsd6` stays a stored calculation used to derive the INR amount. It is not split out of the transfer.
- Timeout or no response → `markUnknown` → `PAYOUT_UNKNOWN`. This is not proof of failure. No refund.
- Adapter `DEFINITE_REJECT` → log it, leave the chain state unchanged, do not call the rail again for that `payoutId`. Refund after reject is roadmap.
- `confirmPayout` is the relayer's attestation. The chain does not see an independent rail proof.

`SETTLED` means the relayer attested that the adapter returned `CONFIRMED` for this `payoutId`.

A relayer that stays down leaves funds in `PAYOUT_PENDING` or `PAYOUT_UNKNOWN`. Automatic refund on timeout is intentionally absent, because a late credit would double-pay.

## Idempotency

`rail/data/payouts.json` maps `payoutId` to `{ outcome, referenceType, simulatedReference }`. The adapter writes the file before it returns. A second call with the same id returns the stored row and does not create a second credit.

On startup the relayer loads that file and resumes chain rows in `PAYOUT_PENDING` or `PAYOUT_UNKNOWN`. Stored `CONFIRMED` only sends `confirmPayout`. Stored `DEFINITE_REJECT` logs and stops.

`MockUPI` sets `referenceType` to `SIMULATED`. The UI says "Simulated reference". That string is not an NPCI or bank RRN. It is not written into the chain event.

## Purpose codes

- `purposeTag` is the product tag. The demo remittance uses `TUITION`.
- `purposeCode` is a **demo mapping**, not a filing instruction.

P1107 and P1108 describe educational and health services received by non-residents from Indian institutions. P1301 is an inward remittance from non-residents for family maintenance and savings. Family-funded tuition may be reported as P1301.

This build ships `purposeCode = P1301` with `purposeTag = TUITION` until a Citi mentor says otherwise.

## Guardian

Raw notice text stays off the chain. When `ANTHROPIC_API_KEY` is set, the model extracts `merchantCategory`, `lineItems[].category`, `issuerName`, and writes reasons. It does not choose the final decision.

The deterministic floor, for `TUITION`: there is at least one line item, and every line-item category is `EDUCATION_FEE`. Otherwise `hold` with `line_item_category_mismatch`. The word "tuition" in the text does not pass the rule.

- Rule holds → `hold`, even if the model extracted friendly fields or said approve
- Rule would approve and the model says hold → `hold`
- Rule would approve and there is no key, or the model does not escalate → `approve`
- Extraction failure → `hold`

Quote and compliance are modules. They are not agents. The screen says: "Advisory signal only. Not KYC, not sanctions screening, and not proof the invoice is genuine."

## Audit export

Columns: `remittanceId`, `purposeTag`, `purposeCode`, `quoteId`, `grossUsd6`, `feeUsd6`, `netUsd6`, `netInrPaise`, `payoutId`, `partyRef`, `beneficiaryRef`, `referenceType`, `simulatedReference`, `txHash`.

`partyRef` and `beneficiaryRef` are HMAC hex. The file has no raw VPA, name, or notice text. The page says the file is a demo extract, not a regulatory filing.
