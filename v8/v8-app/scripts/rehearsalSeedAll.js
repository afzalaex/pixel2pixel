const fs = require("fs");
const path = require("path");

const dotenv = require("dotenv");
const WebSocket = require("ws");
const { ethers } = require("ethers");

const APP_DIR = path.join(__dirname, "..");
const APP_ENV_PATH = path.join(APP_DIR, ".env");
const CONTRACTS_ENV_PATH = path.join(APP_DIR, "..", "v8-contracts", ".env");
const PID_FILE = path.join(APP_DIR, ".seed-all.pid");

// Load app env first, then fallback to contracts env for shared rehearsal vars.
dotenv.config({ path: APP_ENV_PATH });
dotenv.config({ path: CONTRACTS_ENV_PATH });

const CONFIG_PATH = path.join(APP_DIR, "contract-config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

const DEFAULT_CHAIN_ID = Number(config.chainId || 11155111);
const DEFAULT_RPC = config.readRpc || "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_SERVER_URL = `http://localhost:${Number(process.env.PORT || 8080)}`;

const mnemonic = (process.env.SEED_MNEMONIC || process.env.REHEARSAL_MNEMONIC || "").trim();
if (!mnemonic) {
  throw new Error(
    `Missing SEED_MNEMONIC or REHEARSAL_MNEMONIC (checked ${APP_ENV_PATH} and ${CONTRACTS_ENV_PATH})`
  );
}

const seedCount = Number.parseInt(process.env.SEED_COUNT || "100", 10);
if (!Number.isFinite(seedCount) || seedCount <= 0) {
  throw new Error(`Invalid SEED_COUNT: ${process.env.SEED_COUNT}`);
}

const holdSeconds = Number.parseInt(process.env.SEED_HOLD_SECONDS || "180", 10);
if (!Number.isFinite(holdSeconds) || holdSeconds < 0) {
  throw new Error(`Invalid SEED_HOLD_SECONDS: ${process.env.SEED_HOLD_SECONDS}`);
}

const serverUrl = (process.env.SEED_SERVER_URL || DEFAULT_SERVER_URL).trim();
const wsUrl = (process.env.SEED_WS_URL || serverUrl.replace(/^http/i, "ws")).trim();

const rpcUrl =
  process.env.SEPOLIA_RPC ||
  process.env.PUBLIC_SEPOLIA_RPC ||
  config.readRpc ||
  DEFAULT_RPC;

const provider = new ethers.JsonRpcProvider(rpcUrl, DEFAULT_CHAIN_ID);
const nodes = new ethers.Contract(
  config.nodes.address,
  [
    "function nodeOf(address) view returns (uint256)",
    "function ownerOf(uint256) view returns (address)"
  ],
  provider
);

function seedMessage(nonce) {
  return `P2P v8 seeding authorization\nNonce: ${nonce}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claimPidFile() {
  if (fs.existsSync(PID_FILE)) {
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    const existingPid = Number.parseInt(raw, 10);
    if (Number.isFinite(existingPid) && existingPid > 0 && isPidRunning(existingPid)) {
      throw new Error(
        `Another seed-all instance is running (PID ${existingPid}). Run npm run rehearsal:seed-all:stop first.`
      );
    }
  }

  fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
}

function releasePidFile() {
  try {
    if (!fs.existsSync(PID_FILE)) {
      return;
    }
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    if (raw === String(process.pid)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}

function deriveWallet(index) {
  return ethers.HDNodeWallet.fromPhrase(
    mnemonic,
    undefined,
    `m/44'/60'/0'/0/${index}`
  ).connect(provider);
}

async function resolveSeeders() {
  const seeders = [];

  for (let i = 0; i < seedCount; i += 1) {
    const wallet = deriveWallet(i);
    const nodeId = Number(await nodes.nodeOf(wallet.address));
    if (!Number.isInteger(nodeId) || nodeId <= 0) {
      continue;
    }

    const owner = ethers.getAddress(await nodes.ownerOf(nodeId));
    if (owner !== wallet.address) {
      continue;
    }

    seeders.push({ wallet, nodeId, index: i });
  }

  return seeders.sort((a, b) => a.nodeId - b.nodeId);
}

async function connectSeeder(seeder, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {}
      reject(new Error(`Seeder timeout for node ${seeder.nodeId}`));
    }, timeoutMs);

    function finishError(message) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      reject(new Error(message));
    }

    ws.on("message", async (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (payload.type === "challenge") {
        try {
          const signature = await seeder.wallet.signMessage(seedMessage(payload.nonce));
          ws.send(
            JSON.stringify({
              type: "seed-auth",
              nonce: payload.nonce,
              wallet: seeder.wallet.address,
              node: seeder.nodeId,
              signature
            })
          );
        } catch (error) {
          finishError(
            `Signing failed for node ${seeder.nodeId}: ${error.message || "unknown error"}`
          );
        }
        return;
      }

      if (payload.type === "seed-ack") {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ws, seeder });
        return;
      }

      if (payload.type === "error") {
        finishError(
          `Seeder error for node ${seeder.nodeId}: ${payload.message || "unknown error"}`
        );
      }
    });

    ws.on("error", (error) => {
      finishError(`Socket error for node ${seeder.nodeId}: ${error.message || "unknown error"}`);
    });

    ws.on("close", () => {
      if (!done) {
        finishError(`Socket closed before ack for node ${seeder.nodeId}`);
      }
    });
  });
}

async function fetchRoundState() {
  if (typeof fetch !== "function") {
    return null;
  }

  try {
    const response = await fetch(`${serverUrl}/round-state`, { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

async function main() {
  claimPidFile();
  console.log(`Rehearsal seeding helper`);
  console.log(`  ws: ${wsUrl}`);
  console.log(`  rpc: ${rpcUrl}`);
  console.log(`  deriving up to: ${seedCount} wallets`);

  const seeders = await resolveSeeders();
  if (!seeders.length) {
    throw new Error(
      "No owned nodes found for derived wallets. Mint first, or increase SEED_COUNT."
    );
  }

  console.log(`  eligible seeders: ${seeders.length}`);
  const settled = await Promise.allSettled(seeders.map((seeder) => connectSeeder(seeder)));

  const sessions = [];
  const failures = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      sessions.push(result.value);
    } else {
      failures.push(result.reason?.message || "unknown error");
    }
  }

  console.log(`  seeded acks: ${sessions.length}/${seeders.length}`);
  if (failures.length) {
    console.log(`  failed: ${failures.length}`);
    for (const message of failures.slice(0, 10)) {
      console.log(`    - ${message}`);
    }
  }

  const heartbeat = setInterval(() => {
    for (const { ws } of sessions) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }
  }, 15000);

  const roundState = await fetchRoundState();
  if (roundState) {
    const seededCount = Object.keys(roundState.alive || {}).length;
    console.log(
      `  server alive count: ${seededCount} | totalSupply: ${roundState.totalSupply} | terminal: ${Boolean(roundState.terminal)}`
    );
  } else {
    console.log(`  round-state check unavailable`);
  }

  async function closeAll() {
    clearInterval(heartbeat);
    await Promise.all(
      sessions.map(
        ({ ws }) =>
          new Promise((resolve) => {
            if (ws.readyState === WebSocket.CLOSED) {
              resolve();
              return;
            }

            ws.once("close", () => resolve());
            try {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "seed-stop" }));
              }
              ws.close();
            } catch {
              resolve();
            }
          })
      )
    );
  }

  let shuttingDown = false;
  async function shutdownAndExit(resolveHold) {
    if (shuttingDown) return;
    shuttingDown = true;
    await closeAll();
    releasePidFile();
    if (typeof resolveHold === "function") {
      resolveHold();
    }
  }

  if (holdSeconds > 0) {
    console.log(`  holding sessions for ${holdSeconds}s...`);
    await sleep(holdSeconds * 1000);
    await shutdownAndExit();
    console.log("done");
    return;
  }

  console.log("  holding sessions until Ctrl+C...");
  await new Promise((resolve) => {
    process.on("SIGINT", () => {
      shutdownAndExit(resolve).catch(() => resolve());
    });
    process.on("SIGTERM", () => {
      shutdownAndExit(resolve).catch(() => resolve());
    });
  });
}

main().catch((error) => {
  releasePidFile();
  console.error(error);
  process.exitCode = 1;
});
