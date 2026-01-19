#!/usr/bin/env bun

import { compressWithPadding, decompressWithPadding } from "./compression";

const args = process.argv.slice(2);

function printUsage() {
  console.log(`Usage:
  handoff serve [--port=PORT]     Start the relay server (default port: 3000)
  handoff <command> [args...]     Run a command and handoff to viewers

Environment variables:
  HANDOFF_TOKEN    Authentication token (default: "secret")
  HANDOFF_SERVER   Server URL for runner mode (default: "ws://localhost:3000")
  HANDOFF_PORT     Server port for serve mode (default: 3000)
`);
  process.exit(1);
}

if (args.length === 0) {
  printUsage();
}

// ============================================================================
// SERVE MODE - delegate to server.ts
// ============================================================================

if (args[0] === "serve") {
  const serverArgs = args.slice(1);
  const proc = Bun.spawn(["bun", "server.ts", ...serverArgs], {
    cwd: import.meta.dir,
    stdio: ["inherit", "inherit", "inherit"],
  });
  
  process.on("SIGINT", () => proc.kill("SIGINT"));
  process.on("SIGTERM", () => proc.kill("SIGTERM"));
  
  const code = await proc.exited;
  process.exit(code);
}

// ============================================================================
// RUNNER MODE
// ============================================================================

const [cmd, ...cmdArgs] = args;

const TOKEN = process.env.HANDOFF_TOKEN || "secret";
const SERVER = process.env.HANDOFF_SERVER || "ws://localhost:3000";
const STARTUP_TIMEOUT = 5000; // 5 seconds

const ws = new WebSocket(`${SERVER}/runner?token=${TOKEN}`);

const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;

let proc: ReturnType<typeof Bun.spawn> | null = null;

function launchProcess() {
  if (proc) return; // Already launched
  console.error(`[Starting: ${cmd} ${cmdArgs.join(" ")}]`);

  proc = Bun.spawn([cmd, ...cmdArgs], {
    terminal: {
      cols,
      rows,
      async data(term, data) {
        process.stdout.write(data);
        // Compress PTY output before sending
        const compressed = await compressWithPadding(new Uint8Array(data));
        ws.send(compressed);
      },
    },
  });

  // Connect local stdin to the PTY
  process.stdin.setRawMode(true);
  process.stdin.on("data", (data) => {
    if (proc) {
      proc.terminal.write(data);
    }
  });

  proc.exited.then((code) => {
    ws.send(JSON.stringify({ type: "exit", code }));
    proc!.terminal.close();
    ws.close();
    process.exit(code);
  });
}

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "resize", cols, rows }));
};

ws.onmessage = async (e) => {
  if (typeof e.data === "string") {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "session") {
        console.error(`\n[Session ID: ${msg.id}]`);
        console.error(`[Server: ${SERVER}]`);
        console.error(`[Press Enter to start, or wait 5s...]`);
        
        // Wait for Enter key or timeout
        const timeout = setTimeout(() => {
          launchProcess();
        }, STARTUP_TIMEOUT);
        
        // Listen for Enter key (temporarily enable raw mode)
        process.stdin.setRawMode(true);
        process.stdin.once("data", () => {
          clearTimeout(timeout);
          // Don't disable raw mode - launchProcess will keep it enabled
          launchProcess();
        });
        
        return;
      }
    } catch {}
    // Non-JSON string - shouldn't happen but ignore
  } else if (proc) {
    // Binary data - compressed input from viewer
    const data = e.data instanceof ArrayBuffer 
      ? new Uint8Array(e.data) 
      : new Uint8Array(e.data);
    const decompressed = await decompressWithPadding(data);
    proc.terminal.write(decompressed);
  }
};

ws.onclose = () => {
  if (!proc) {
    console.error("[Connection closed before process started]");
    process.exit(1);
  }
};

ws.onerror = (err) => {
  console.error("[WebSocket error]", err);
  process.exit(1);
};

process.stdout.on("resize", () => {
  ws.send(JSON.stringify({ type: "resize", cols: process.stdout.columns, rows: process.stdout.rows }));
});
