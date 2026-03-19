import net from "node:net";
import { spawn } from "node:child_process";

const PORT = Number(process.env.TAURI_DEV_PORT || 1421);
const DEV_URL = `http://127.0.0.1:${PORT}`;
const CHECK_ONLY = process.argv.includes("--check");

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

async function fetchRootHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function isNCodeDevServer() {
  try {
    const html = await fetchRootHtml(DEV_URL);
    return html.includes("<title>NCode</title>") && html.includes('/src/main.tsx');
  } catch {
    return false;
  }
}

async function main() {
  const portOpen = await isPortOpen(PORT);

  if (!portOpen) {
    if (CHECK_ONLY) {
      console.log(`[tauri-dev] Port ${PORT} is free.`);
      return;
    }

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const child = spawn(npmCommand, ["run", "dev:vite"], {
      stdio: "inherit",
      env: process.env,
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      process.exit(code ?? 0);
    });

    return;
  }

  const expectedServer = await isNCodeDevServer();
  if (expectedServer) {
    console.log(`[tauri-dev] Reusing existing NCode dev server on ${DEV_URL}`);
    return;
  }

  const message =
    `[tauri-dev] Port ${PORT} is already in use by a different process.\n` +
    `Stop that process or change both vite.config.ts and src-tauri/tauri.conf.json together.`;

  if (CHECK_ONLY) {
    console.error(message);
    process.exit(1);
  }

  throw new Error(message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
