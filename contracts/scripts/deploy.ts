import { ethers, network } from "hardhat";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const PARTIES = {
  senderVpa: "arun@purposepay.demo",
  beneficiaryVpa: "priya@purposepay.demo",
  harbourview: "fees@harbourview.demo",
  northgate: "fees@northgate.demo",
  citycare: "billing@citycare.demo",
  friend: "friend@purposepay.demo",
};

const GROSS = 200_000_000n;
const SCHOOL = 1;
const HOSPITAL = 2;

function commit(vpa: string) {
  return ethers.keccak256(ethers.toUtf8Bytes(vpa));
}

async function main() {
  const [owner, sender, relayer, treasury] = await ethers.getSigners();
  const Usd = await ethers.getContractFactory("MockUSD");
  const usd = await Usd.deploy();
  await usd.waitForDeployment();

  const Vault = await ethers.getContractFactory("PurposeVault");
  const vault = await Vault.deploy(await usd.getAddress(), relayer.address, treasury.address);
  await vault.waitForDeployment();

  await (await usd.mint(sender.address, 1_000_000_000_000n)).wait();
  await (await usd.connect(sender).approve(await vault.getAddress(), ethers.MaxUint256)).wait();

  const block = await ethers.provider.getBlock("latest");
  const validUntil = Number(block!.timestamp) + 7 * 24 * 60 * 60;
  await (await vault.setQuote(8350, validUntil)).wait();
  await (await vault.registerPayee(commit(PARTIES.harbourview), SCHOOL)).wait();
  await (await vault.registerPayee(commit(PARTIES.northgate), SCHOOL)).wait();
  await (await vault.registerPayee(commit(PARTIES.citycare), HOSPITAL)).wait();

  const createTx = await vault
    .connect(sender)
    .createRemittance(commit(PARTIES.beneficiaryVpa), commit(PARTIES.harbourview), 0, GROSS);
  const createReceipt = await createTx.wait();

  const outDir = process.env.DEPLOYMENTS_DIR
    ? path.resolve(process.env.DEPLOYMENTS_DIR)
    : path.resolve(__dirname, "..", "..", "deployments");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "local.json");
  const payload = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    rpcUrl: (network.config as { url?: string }).url ?? process.env.RPC_URL ?? "http://127.0.0.1:8545",
    usd: await usd.getAddress(),
    vault: await vault.getAddress(),
    owner: owner.address,
    sender: sender.address,
    relayer: relayer.address,
    treasury: treasury.address,
    senderKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    relayerKey: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    validUntil,
    seededRemittanceId: 0,
    seedCreateTx: createReceipt?.hash ?? null,
    parties: PARTIES,
    note: "Hardhat default keys. Local demo only.",
  };
  writeFileSync(file, JSON.stringify(payload, null, 2));
  console.log(`deployed vault ${payload.vault}`);
  console.log(`wrote ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
