const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const APP_DIR = path.join(__dirname, "..");
const PID_FILE = path.join(APP_DIR, ".seed-all.pid");

function readPid() {
  if (!fs.existsSync(PID_FILE)) {
    return 0;
  }

  const raw = fs.readFileSync(PID_FILE, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return 0;
  }
  return pid;
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function clearPidFile() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {}
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function stop() {
  const pid = readPid();
  if (!pid) {
    console.log("No seed-all PID file found.");
    return;
  }

  if (!isRunning(pid)) {
    clearPidFile();
    console.log(`Seed-all process ${pid} is not running.`);
    return;
  }

  console.log(`Stopping seed-all process ${pid}...`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {}

  for (let i = 0; i < 10; i += 1) {
    if (!isRunning(pid)) {
      clearPidFile();
      console.log("Seed-all stopped.");
      return;
    }
    await sleep(200);
  }

  // Windows fallback: force kill process tree.
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true
  });

  if (!isRunning(pid)) {
    clearPidFile();
    console.log("Seed-all force-stopped.");
    return;
  }

  console.log("Unable to stop seed-all automatically.");
}

stop().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
