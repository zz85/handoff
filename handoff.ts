#!/usr/bin/env bun

import { zstdCompress, zstdDecompress, smazCompress, smazDecompress } from "./compression";

const args = process.argv.slice(2);

function printUsage() {
  console.log(`Usage:
  handoff serve [options]                     Start standalone relay server
  handoff [options] <command> [args...]       Run command with integrated server
  handoff --connect=URL [options] <command>   Run command and connect to remote server

Options:
  --port=PORT           Server port (default: 3000)
  --compression=MODE    Compression: none, zstd, deflate (default), smaz
  --connect=URL         Connect to remote server instead of starting local
  --token=TOKEN         Auth token (default: env HANDOFF_TOKEN or "secret")

Examples:
  handoff serve --port=8080              # Start standalone server
  handoff --port=8080 vim file.txt       # Integrated server + command
  handoff --connect=ws://host:3000 htop  # Connect to remote server

Environment variables:
  HANDOFF_TOKEN       Authentication token (default: "secret")
  HANDOFF_SERVER      Server URL for connect mode (default: "ws://localhost:3000")
  HANDOFF_PORT        Server port (default: 3000)
  HANDOFF_COMPRESSION Compression mode (default: "deflate")
`);
  process.exit(1);
}

if (args.length === 0) {
  printUsage();
}

// ============================================================================
// Parse arguments
// ============================================================================

let port = parseInt(process.env.HANDOFF_PORT || "3000", 10);
let token = process.env.HANDOFF_TOKEN || "secret";
let connectUrl = process.env.HANDOFF_SERVER || "";
let compressionArg = process.env.HANDOFF_COMPRESSION || "deflate";
const commandArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith("--port=")) {
    port = parseInt(arg.slice(7), 10);
  } else if (arg.startsWith("--token=")) {
    token = arg.slice(8);
  } else if (arg.startsWith("--connect=")) {
    connectUrl = arg.slice(10);
  } else if (arg.startsWith("--compression=")) {
    compressionArg = arg.slice(14);
  } else if (arg === "--help" || arg === "-h") {
    printUsage();
  } else if (arg.startsWith("--")) {
    console.error(`Unknown option: ${arg}`);
    process.exit(1);
  } else {
    // First non-option arg and everything after is the command
    commandArgs.push(...args.slice(i));
    break;
  }
}

// ============================================================================
// SERVE MODE - standalone server (no command)
// ============================================================================

if (commandArgs[0] === "serve") {
  const serverArgs: string[] = [`--port=${port}`, `--compression=${compressionArg}`];
  const proc = Bun.spawn(["bun", "server.ts", ...serverArgs], {
    cwd: import.meta.dir,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, HANDOFF_TOKEN: token },
  });
  
  process.on("SIGINT", () => proc.kill("SIGINT"));
  process.on("SIGTERM", () => proc.kill("SIGTERM"));
  
  const code = await proc.exited;
  process.exit(code);
}

// ============================================================================
// Command required for other modes
// ============================================================================

if (commandArgs.length === 0) {
  printUsage();
}

const [cmd, ...cmdRestArgs] = commandArgs;

// ============================================================================
// Compression helpers
// ============================================================================

type CompressionMode = "none" | "zstd" | "deflate" | "smaz";
let compressionMode: CompressionMode = compressionArg as CompressionMode;

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

// ============================================================================
// CONNECT MODE - connect to remote server
// ============================================================================

if (connectUrl) {
  const SERVER = connectUrl.startsWith("ws://") || connectUrl.startsWith("wss://") 
    ? connectUrl 
    : `ws://${connectUrl}`;
  
  const ws = new WebSocket(`${SERVER}/runner?token=${token}`, {
    headers: { "User-Agent": "Handoff/1.0" },
  });

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let term: ReturnType<typeof Bun.spawn>["terminal"] | null = null;

  function launchProcess() {
    if (proc) return;
    console.error(`[Starting: ${cmd} ${cmdRestArgs.join(" ")}]`);

    proc = Bun.spawn([cmd, ...cmdRestArgs], {
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
      if (term) term.write(data);
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
          if (msg.compression) compressionMode = msg.compression;
          // Build viewer URL from WebSocket URL
          const httpUrl = SERVER.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
          const viewerUrl = `${httpUrl}/?id=${msg.id}&token=${token}`;
          console.error(`\n[Session ID: ${msg.id}]`);
          console.error(`[View at: ${viewerUrl}]`);
          console.error(`[Compression: ${compressionMode}]`);
          console.error(`[Press Enter to start, or wait 5s...]`);
          
          const timeout = setTimeout(() => launchProcess(), 5000);
          process.stdin.setRawMode(true);
          process.stdin.once("data", () => {
            clearTimeout(timeout);
            launchProcess();
          });
          return;
        }
      } catch {}
    } else if (term) {
      const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : new Uint8Array(e.data);
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
}

// ============================================================================
// INTEGRATED MODE - start server and run command together
// ============================================================================

else {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  
  // Generate session ID
  const words = ["apple", "banana", "cherry", "delta", "eagle", "forest", "grape", "harbor", "island", "jungle", "kite", "lemon", "mango", "north", "ocean", "palm", "quartz", "river", "storm", "tiger"];
  const sessionId = words[Math.random() * words.length | 0] + "-" + words[Math.random() * words.length | 0] + "-" + words[Math.random() * words.length | 0];
  
  // Start the server in background
  const serverProc = Bun.spawn(["bun", "server.ts", `--port=${port}`, `--compression=${compressionArg}`], {
    cwd: import.meta.dir,
    stdio: ["inherit", "pipe", "pipe"],
    env: { ...process.env, HANDOFF_TOKEN: token },
  });

  // Wait for server to start, then continue piping stderr
  const stderrReader = serverProc.stderr.getReader();
  const decoder = new TextDecoder();
  let serverReady = false;
  
  async function pipeStderr() {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      const text = decoder.decode(value);
      process.stderr.write(text);
      if (!serverReady && text.includes("[Server Started]")) {
        serverReady = true;
      }
    }
  }
  
  // Start piping in background
  pipeStderr();
  
  // Wait for server to be ready or timeout
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (serverReady) {
        clearInterval(check);
        resolve();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(check);
      resolve();
    }, 5000);
  });

  // Connect to our own server
  const ws = new WebSocket(`ws://localhost:${port}/runner?token=${token}&id=${sessionId}`, {
    headers: { "User-Agent": "Handoff/1.0" },
  });

  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let term: ReturnType<typeof Bun.spawn>["terminal"] | null = null;

  function launchProcess() {
    if (proc) return;
    console.error(`[Starting: ${cmd} ${cmdRestArgs.join(" ")}]`);

    proc = Bun.spawn([cmd, ...cmdRestArgs], {
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
      if (term) term.write(data);
    });

    proc.exited.then((code) => {
      ws.send(JSON.stringify({ type: "exit", code }));
      if (term) term.close();
      ws.close();
      serverProc.kill();
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
          if (msg.compression) compressionMode = msg.compression;
          console.error(`\n[Session ID: ${msg.id}]`);
          console.error(`[View at: http://localhost:${port}/?id=${msg.id}&token=${token}]`);
          console.error(`[Compression: ${compressionMode}]`);
          console.error(`[Press Enter to start, or wait 5s...]`);
          
          const timeout = setTimeout(() => launchProcess(), 5000);
          process.stdin.setRawMode(true);
          process.stdin.once("data", () => {
            clearTimeout(timeout);
            launchProcess();
          });
          return;
        }
      } catch {}
    } else if (term) {
      const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : new Uint8Array(e.data);
      const decompressed = await decompress(data);
      term.write(decompressed);
    }
  };

  ws.onclose = () => {
    if (!proc) {
      console.error("[Connection closed before process started]");
      serverProc.kill();
      process.exit(1);
    }
  };

  ws.onerror = (err) => {
    console.error("[WebSocket error]", err);
    serverProc.kill();
    process.exit(1);
  };

  process.stdout.on("resize", () => {
    ws.send(JSON.stringify({ type: "resize", cols: process.stdout.columns, rows: process.stdout.rows }));
  });

  // Cleanup on exit
  function cleanup(code = 0) {
    if (term) term.close();
    ws.close();
    serverProc.kill();
    process.exit(code);
  }

  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));
  process.on("SIGHUP", () => cleanup(0));
  
  // Handle unexpected exits
  process.on("exit", () => {
    serverProc.kill();
  });
}
