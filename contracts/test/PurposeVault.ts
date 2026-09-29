import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { PurposeVault, MockUSD } from "../typechain-types";
import { Signer } from "ethers";

const HARBOUR = "fees@harbourview.demo";
const NORTH = "fees@northgate.demo";
const HOSPITAL = "billing@citycare.demo";
const FRIEND = "friend@purposepay.demo";
const PRIYA = "priya@purposepay.demo";
const GROSS = 200_000_000n;
const TUITION = 0;
const SCHOOL = 1;
const HOSPITAL_CAT = 2;

function commit(vpa: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(vpa));
}

describe("PurposeVault", function () {
  let owner: Signer;
  let sender: Signer;
  let relayer: Signer;
  let treasury: Signer;
  let feeAccount: Signer;
  let usd: MockUSD;
  let vault: PurposeVault;
  let validUntil: number;

  beforeEach(async function () {
    [owner, sender, relayer, treasury, feeAccount] = await ethers.getSigners();
    const Usd = await ethers.getContractFactory("MockUSD");
    usd = (await Usd.deploy()) as unknown as MockUSD;
    const Vault = await ethers.getContractFactory("PurposeVault");
    vault = (await Vault.deploy(
      await usd.getAddress(),
      await relayer.getAddress(),
      await treasury.getAddress(),
      await feeAccount.getAddress(),
    )) as unknown as PurposeVault;
    await usd.mint(await sender.getAddress(), 1_000_000_000_000n);
    await usd.connect(sender).approve(await vault.getAddress(), ethers.MaxUint256);
    const now = await time.latest();
    validUntil = now + 7 * 24 * 60 * 60;
    await vault.setQuote(8350, validUntil);
    await vault.registerPayee(commit(HARBOUR), SCHOOL);
    await vault.registerPayee(commit(NORTH), SCHOOL);
    await vault.registerPayee(commit(HOSPITAL), HOSPITAL_CAT);
  });

  it("matches the UTF-8 commitment used off chain", async function () {
    expect(await vault.commitmentOf(HARBOUR)).to.equal(commit(HARBOUR));
  });

  it("rejects a quote from a non-owner", async function () {
    await expect(vault.connect(sender).setQuote(8350, validUntil + 10)).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount",
    );
  });

  it("reverts an unregistered payee inside createRemittance and keeps the tokens", async function () {
    const before = await usd.balanceOf(await sender.getAddress());
    await expect(
      vault.connect(sender).createRemittance(commit(PRIYA), commit(FRIEND), TUITION, GROSS, { gasLimit: 400_000 }),
    ).to.be.revertedWithCustomError(vault, "UnregisteredPayee");
    expect(await usd.balanceOf(await sender.getAddress())).to.equal(before);
    expect(await vault.remittanceCount()).to.equal(0);
  });

  it("reverts a hospital payee on tuition inside createRemittance", async function () {
    await expect(
      vault.connect(sender).createRemittance(commit(PRIYA), commit(HOSPITAL), TUITION, GROSS, { gasLimit: 400_000 }),
    ).to.be.revertedWithCustomError(vault, "CategoryMismatch");
  });

  it("stores the owner quote math and ignores any sender-supplied rate", async function () {
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    const row = await vault.remittances(0);
    expect(row.grossUsd6).to.equal(GROSS);
    expect(row.feeUsd6).to.equal(1_000_000n);
    expect(row.netUsd6).to.equal(199_000_000n);
    expect(row.netInrPaise).to.equal(1_661_650n);
    expect(row.ratePaisePerUsd).to.equal(8350n);
    expect(row.quoteId).to.equal(await vault.currentQuoteId());
    const fragment = vault.interface.getFunction("reservePayout");
    expect(fragment.inputs.length).to.equal(1);
    expect(fragment.inputs[0].name).to.equal("id");
  });

  it("previews PayeeNotAuthorized for another school without moving state", async function () {
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    await expect(vault.previewPayout(0, commit(NORTH))).to.be.revertedWithCustomError(vault, "PayeeNotAuthorized");
    expect((await vault.remittances(0)).status).to.equal(1n);
  });

  it("rejects confirm before reserve and refund from PAYOUT_UNKNOWN", async function () {
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    await expect(vault.connect(relayer).confirmPayout(0, ethers.ZeroHash)).to.be.revertedWithCustomError(
      vault,
      "InvalidStatus",
    );
    await vault.connect(relayer).reservePayout(0);
    const payoutId = (await vault.remittances(0)).payoutId;
    expect(payoutId).to.equal(await vault.computePayoutId(0));
    await vault.connect(relayer).markUnknown(0, payoutId);
    await expect(vault.connect(sender).refund(0)).to.be.revertedWithCustomError(vault, "InvalidStatus");
  });

  it("rechecks the registry at reserve time", async function () {
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    await vault.deregisterPayee(commit(HARBOUR));
    await expect(vault.connect(relayer).reservePayout(0)).to.be.revertedWithCustomError(vault, "UnregisteredPayee");
  });

  it("settles only the stored paise amount", async function () {
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    await vault.connect(relayer).reservePayout(0);
    const row = await vault.remittances(0);
    const tx = await vault.connect(relayer).confirmPayout(0, row.payoutId);
    const receipt = await tx.wait();
    const settled = receipt?.logs
      .map((log) => {
        try {
          return vault.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "RemittanceSettled");
    expect(settled?.args.netInrPaise).to.equal(1_661_650n);
    expect((await vault.remittances(0)).status).to.equal(4n);
  });

  it("pays net principal to the treasury and the fee to the fee account, and refunds the gross from OPEN", async function () {
    const vaultAddress = await vault.getAddress();
    const treasuryAddress = await treasury.getAddress();
    const feeAddress = await feeAccount.getAddress();
    const senderAddress = await sender.getAddress();

    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    const vaultAfterLock = await usd.balanceOf(vaultAddress);
    const treasuryBefore = await usd.balanceOf(treasuryAddress);
    const feeBefore = await usd.balanceOf(feeAddress);
    await vault.connect(relayer).reservePayout(0);
    await vault.connect(relayer).confirmPayout(0, (await vault.remittances(0)).payoutId);

    expect(await usd.balanceOf(vaultAddress)).to.equal(vaultAfterLock - GROSS);
    expect(await usd.balanceOf(treasuryAddress)).to.equal(treasuryBefore + 199_000_000n);
    expect(await usd.balanceOf(feeAddress)).to.equal(feeBefore + 1_000_000n);
    expect((await vault.remittances(0)).feeUsd6).to.equal(1_000_000n);
    expect((await vault.remittances(0)).netUsd6).to.equal(199_000_000n);
    expect((await vault.remittances(0)).status).to.equal(4n);

    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    const senderBeforeRefund = await usd.balanceOf(senderAddress);
    const vaultBeforeRefund = await usd.balanceOf(vaultAddress);
    await time.increaseTo(validUntil + 1);
    await vault.connect(sender).refund(1);

    expect(await usd.balanceOf(senderAddress)).to.equal(senderBeforeRefund + GROSS);
    expect(await usd.balanceOf(vaultAddress)).to.equal(vaultBeforeRefund - GROSS);
    expect((await vault.remittances(1)).status).to.equal(5n);
  });

  it("pays the treasury only once, including after a failed confirm", async function () {
    const treasuryAddress = await treasury.getAddress();
    const feeAddress = await feeAccount.getAddress();
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    await vault.connect(relayer).reservePayout(0);
    const payoutId = (await vault.remittances(0)).payoutId;
    await expect(vault.connect(relayer).confirmPayout(0, ethers.id("wrong"))).to.be.revertedWithCustomError(
      vault,
      "PayoutIdMismatch",
    );
    expect((await vault.remittances(0)).status).to.equal(2n);
    expect(await usd.balanceOf(treasuryAddress)).to.equal(0n);

    await vault.connect(relayer).confirmPayout(0, payoutId);
    const treasuryAfter = await usd.balanceOf(treasuryAddress);
    const feeAfter = await usd.balanceOf(feeAddress);
    expect(treasuryAfter).to.equal(199_000_000n);
    expect(feeAfter).to.equal(1_000_000n);

    await expect(vault.connect(relayer).confirmPayout(0, payoutId)).to.be.revertedWithCustomError(vault, "InvalidStatus");
    expect(await usd.balanceOf(treasuryAddress)).to.equal(treasuryAfter);
    expect(await usd.balanceOf(feeAddress)).to.equal(feeAfter);
  });

  it("rejects a create after the quote expires", async function () {
    await time.increaseTo(validUntil + 1);
    await expect(
      vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS),
    ).to.be.revertedWithCustomError(vault, "QuoteExpired");
    expect(await vault.remittanceCount()).to.equal(0);
  });

  it("does not allow refund and reserve to both succeed", async function () {
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    await vault.connect(relayer).reservePayout(0);
    await time.increaseTo(validUntil + 1);

    await expect(vault.connect(sender).refund(0)).to.be.revertedWithCustomError(vault, "InvalidStatus");
    expect((await vault.remittances(0)).status).to.equal(2n);

    await vault.connect(sender).refund(1);
    expect((await vault.remittances(1)).status).to.equal(5n);
    await expect(vault.connect(relayer).reservePayout(1)).to.be.revertedWithCustomError(vault, "InvalidStatus");
  });

  it("refunds the gross after a definite reject and still blocks a refund from PAYOUT_UNKNOWN", async function () {
    const senderAddress = await sender.getAddress();
    const vaultAddress = await vault.getAddress();
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    await vault.connect(sender).createRemittance(commit(PRIYA), commit(HARBOUR), TUITION, GROSS);
    await vault.connect(relayer).reservePayout(0);
    await vault.connect(relayer).reservePayout(1);
    const rejectedId = (await vault.remittances(0)).payoutId;
    const unknownId = (await vault.remittances(1)).payoutId;
    await vault.connect(relayer).markRejected(0, rejectedId);
    await vault.connect(relayer).markUnknown(1, unknownId);

    expect((await vault.remittances(0)).status).to.equal(6n);
    const before = await usd.balanceOf(senderAddress);
    const vaultBefore = await usd.balanceOf(vaultAddress);
    await vault.connect(sender).refund(0);
    expect(await usd.balanceOf(senderAddress)).to.equal(before + GROSS);
    expect(await usd.balanceOf(vaultAddress)).to.equal(vaultBefore - GROSS);
    expect((await vault.remittances(0)).status).to.equal(5n);
    await expect(vault.connect(sender).refund(1)).to.be.revertedWithCustomError(vault, "InvalidStatus");
    await expect(vault.connect(relayer).confirmPayout(0, rejectedId)).to.be.revertedWithCustomError(vault, "InvalidStatus");
  });
});
