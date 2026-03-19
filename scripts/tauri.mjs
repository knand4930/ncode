import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";

const DEFAULT_PORT = Number(process.env.TAURI_DEV_PORT || 1421);
const MAX_PORT_SCAN = 20;
const args = process.argv.slice(2);

function tauriBinary() {
  return path.resolve(
    process.cwd(),
    process.platform === "win32" ? "node_modules/.bin/tauri.cmd" : "node_modules/.bin/tauri"
  );
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function fetchRootHtml(port) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: controller.signal });
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function isNCodeDevServer(port) {
  try {
    const html = await fetchRootHtml(port);
    return html.includes("<title>NCode</title>") && html.includes('/src/main.tsx');
  } catch {
    return false;
  }
}

async function findUsablePort(startPort) {
  for (let port = startPort; port < startPort + MAX_PORT_SCAN; port += 1) {
    const portOpen = await isPortOpen(port);
    if (!portOpen) return port;

    if (await isNCodeDevServer(port)) return port;
  }

  throw new Error(
    `[tauri] Could not find a usable dev port in range ${startPort}-${startPort + MAX_PORT_SCAN - 1}.`
  );
}

function spawnTauri(commandArgs, extraEnv = {}) {
  const child = spawn(tauriBinary(), commandArgs, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

async function main() {
  if (args[0] !== "dev") {
    spawnTauri(args);
    return;
  }

  const subArgs = args.slice(1);
  const port = await findUsablePort(DEFAULT_PORT);
  const overrideConfig = JSON.stringify({
    build: {
      devUrl: `http://localhost:${port}`,
      beforeDevCommand: "npm run dev:tauri-server",
    },
  });

  console.log(`[tauri] Using dev port ${port}`);

  spawnTauri(["dev", "-c", overrideConfig, ...subArgs], {
    TAURI_DEV_PORT: String(port),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
