#!/usr/bin/env bun

import { zstdCompress, zstdDecompress, smazCompress, smazDecompress } from "./compression";

const args = process.argv.slice(2);

function printUsage() {
  console.log(`Usage:
  handoff serve [--port=PORT] [--compression=MODE]   Start the relay server
  handoff <command> [args...]                        Run a command and handoff to viewers

Compression modes: none, zstd (default), deflate, smaz

Environment variables:
  HANDOFF_TOKEN       Authentication token (default: "secret")
  HANDOFF_SERVER      Server URL for runner mode (default: "ws://localhost:3000")
  HANDOFF_PORT        Server port for serve mode (default: 3000)
  HANDOFF_COMPRESSION Compression mode (default: "zstd")
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

// Compression mode - will be set by server on session message
type CompressionMode = "none" | "zstd" | "deflate" | "smaz";
let compressionMode: CompressionMode = "zstd";

// Compression helpers
async function compress(data: Uint8Array): Promise<Uint8Array> {
  if (compressionMode === "zstd") {
    return zstdCompress(data);
  }
  if (compressionMode === "smaz") {
    return smazCompress(data);
  }
  return data;
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  if (compressionMode === "zstd") {
    return zstdDecompress(data);
  }
  if (compressionMode === "smaz") {
    return smazDecompress(data);
  }
  return data;
}

const ws = new WebSocket(`${SERVER}/runner?token=${TOKEN}`, {
  headers: {
    "User-Agent": "Handoff/1.0",
  },
});

const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;

let proc: ReturnType<typeof Bun.spawn> | null = null;
let term: ReturnType<typeof Bun.spawn>["terminal"] | null = null;

function launchProcess() {
  if (proc) return;
  console.error(`[Starting: ${cmd} ${cmdArgs.join(" ")}]`);

  proc = Bun.spawn([cmd, ...cmdArgs], {
    terminal: {
      cols,
      rows,
      async data(t, data) {
        process.stdout.write(data);
        const compressed = await compress(new Uint8Array(data));
        ws.send(compressed);
      },
    },
  });
  
  term = proc.terminal;

  process.stdin.setRawMode(true);
  process.stdin.on("data", (data) => {
    if (term) {
      term.write(data);
    }
  });

  proc.exited.then((code) => {
    ws.send(JSON.stringify({ type: "exit", code }));
    if (term) term.close();
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
        // Server tells us compression mode
        if (msg.compression) {
          compressionMode = msg.compression;
        }
        console.error(`\n[Session ID: ${msg.id}]`);
        console.error(`[Server: ${SERVER}]`);
        console.error(`[Compression: ${compressionMode}]`);
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
  } else if (term) {
    // Binary data - input from viewer
    const data = e.data instanceof ArrayBuffer 
      ? new Uint8Array(e.data) 
      : new Uint8Array(e.data);
    const decompressed = await decompress(data);
    term.write(decompressed);
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
