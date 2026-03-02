const fs = require("fs");
const path = require("path");

const dotenv = require("dotenv");
const WebSocket = require("ws");
const { ethers } = require("ethers");

const APP_DIR = path.join(__dirname, "..");
const APP_ENV_PATH = path.join(APP_DIR, ".env");
const CONTRACTS_ENV_CANDIDATES = [
  path.join(APP_DIR, "..", "v9-contracts", ".env"),
  path.join(APP_DIR, "..", "v8-contracts", ".env"),
  path.join(APP_DIR, "..", "..", "v8", "v8-contracts", ".env")
];
const PID_FILE = path.join(APP_DIR, ".seed-all.pid");

// Load app env first, then known contracts env locations for shared rehearsal vars.
dotenv.config({ path: APP_ENV_PATH });
for (const contractsEnvPath of CONTRACTS_ENV_CANDIDATES) {
  if (fs.existsSync(contractsEnvPath)) {
    dotenv.config({ path: contractsEnvPath });
  }
}

const CONFIG_PATH = path.join(APP_DIR, "contract-config.json");
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

const DEFAULT_CHAIN_ID = Number(config.chainId || 11155111);
const DEFAULT_RPC = config.readRpc || "https://ethereum-sepolia-rpc.publicnode.com";
const DEFAULT_SERVER_URL = `http://127.0.0.1:${Number(process.env.PORT || 8080)}`;

const mnemonic = (process.env.SEED_MNEMONIC || process.env.REHEARSAL_MNEMONIC || "").trim();
if (!mnemonic) {
  throw new Error(
    `Missing SEED_MNEMONIC or REHEARSAL_MNEMONIC (checked ${APP_ENV_PATH} and known contracts .env paths)`
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

const explicitServerUrl = (process.env.SEED_SERVER_URL || "").trim();
const explicitWsUrl = (process.env.SEED_WS_URL || "").trim();

const serverUrl = (explicitServerUrl || DEFAULT_SERVER_URL).trim();
const wsUrl = (explicitWsUrl || serverUrl.replace(/^http/i, "ws")).trim();

let activeServerUrl = serverUrl;
let activeWsUrl = wsUrl;

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

function serverUrlCandidates() {
  if (explicitServerUrl) {
    return [serverUrl];
  }

  const out = [serverUrl];
  if (serverUrl.includes("127.0.0.1")) {
    out.push(serverUrl.replace("127.0.0.1", "localhost"));
  } else if (serverUrl.includes("localhost")) {
    out.push(serverUrl.replace("localhost", "127.0.0.1"));
  }

  return Array.from(new Set(out));
}

function wsUrlFromServer(url) {
  return url.replace(/^http/i, "ws");
}

async function assertBackendReachable(timeoutMs = 5000) {
  if (typeof fetch !== "function") {
    return serverUrl;
  }

  const attempts = [];

  for (const candidate of serverUrlCandidates()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${candidate}/healthz`, {
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`healthz returned ${response.status}`);
      }
      return candidate;
    } catch (error) {
      const detail = error && error.message ? error.message : "unknown error";
      attempts.push(`${candidate} (${detail})`);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Backend unreachable: ${attempts.join("; ")}. Start v9 app backend with "npm start", or set SEED_SERVER_URL/SEED_WS_URL to the active host.`
  );
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
    const ws = new WebSocket(activeWsUrl);
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
      const detail = [error?.message, error?.code, error?.errno]
        .filter((part) => part !== undefined && part !== null && part !== "")
        .join(" | ");
      finishError(`Socket error for node ${seeder.nodeId}: ${detail || "unknown error"}`);
    });

    ws.on("close", (code, reasonBuffer) => {
      if (!done) {
        const reason =
          typeof reasonBuffer === "string"
            ? reasonBuffer
            : reasonBuffer && reasonBuffer.length
              ? reasonBuffer.toString()
              : "";
        finishError(
          `Socket closed before ack for node ${seeder.nodeId} (code ${code}${reason ? `: ${reason}` : ""})`
        );
      }
    });
  });
}

async function fetchRoundState() {
  if (typeof fetch !== "function") {
    return null;
  }

  try {
    const response = await fetch(`${activeServerUrl}/round-state`, { cache: "no-store" });
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
  console.log(`  server: ${serverUrl}`);
  console.log(`  ws: ${wsUrl}`);
  console.log(`  rpc: ${rpcUrl}`);
  console.log(`  deriving up to: ${seedCount} wallets`);
  activeServerUrl = await assertBackendReachable();
  if (!explicitWsUrl) {
    activeWsUrl = wsUrlFromServer(activeServerUrl);
  }
  console.log(`  backend: reachable (${activeServerUrl})`);
  if (activeWsUrl !== wsUrl) {
    console.log(`  ws active: ${activeWsUrl}`);
  }

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

  if (sessions.length === 0) {
    throw new Error(
      "No seeding sessions connected. Verify backend is running and SEED_SERVER_URL/SEED_WS_URL point to the active backend host."
    );
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
