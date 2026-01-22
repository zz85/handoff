import {
  zstdCompress,
  zstdDecompress,
  compressWithPadding,
  decompressWithPadding,
  smazCompress,
  smazDecompress,
  smazCompressWithPadding,
  smazDecompressWithPadding,
  createStatsTracker,
  formatBytes,
} from "./compression";
import { Framebuffer } from "./framebuffer";

// Compression modes: "none" | "zstd" | "deflate" | "smaz"
type CompressionMode = "none" | "zstd" | "deflate" | "smaz";

// Parse args
let port = parseInt(process.env.HANDOFF_PORT || "3000", 10);
let compressionMode: CompressionMode = (process.env.HANDOFF_COMPRESSION as CompressionMode) || "deflate";

for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--port=")) {
    port = parseInt(arg.slice(7), 10);
  } else if (arg.startsWith("--compression=")) {
    const mode = arg.slice(14);
    if (mode === "none" || mode === "zstd" || mode === "deflate" || mode === "smaz") {
      compressionMode = mode;
    } else {
      console.error(`Invalid compression mode: ${mode}. Use: none, zstd, deflate, smaz`);
      process.exit(1);
    }
  }
}

const TOKEN = process.env.HANDOFF_TOKEN || "secret";
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const STATS_LOG_INTERVAL = 60 * 1000; // 60 seconds

function timestamp() {
  return new Date().toISOString();
}

const words = ["apple", "banana", "cherry", "delta", "eagle", "forest", "grape", "harbor", "island", "jungle", "kite", "lemon", "mango", "north", "ocean", "palm", "quartz", "river", "storm", "tiger"];
const genId = () => words[Math.random() * words.length | 0] + "-" + words[Math.random() * words.length | 0] + "-" + words[Math.random() * words.length | 0];

interface Session {
  id: string;
  runner: any;
  viewers: Set<any>;
  framebuffer: Framebuffer;
  exited: boolean;
  cleanupTimer?: Timer;
}

const sessions = new Map<string, Session>();
const serverStats = createStatsTracker();

function scheduleCleanup(session: Session) {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  if (session.exited && session.viewers.size === 0) {
    session.cleanupTimer = setTimeout(() => {
      sessions.delete(session.id);
      console.log(`[${timestamp()}] [Session Expired] session=${session.id}`);
    }, SESSION_TTL);
  }
}

// Log stats every 60 seconds
setInterval(() => {
  const s = serverStats.getSnapshot();
  const inRate = s.bytesInLast5s / 5;
  const outRate = s.bytesOutLast5s / 5;
  const inFps = (s.framesInLast5s / 5).toFixed(1);
  const outFps = (s.framesOutLast5s / 5).toFixed(1);
  
  let totalViewers = 0;
  for (const session of sessions.values()) {
    totalViewers += session.viewers.size;
  }
  
  console.log(
    `[${timestamp()}] [Stats] sessions=${sessions.size} viewers=${totalViewers} | ` +
    `in=${formatBytes(inRate)}/s (${inFps} fps) | ` +
    `out=${formatBytes(outRate)}/s (${outFps} fps) | ` +
    `ratio=${(s.avgCompressionRatio * 100).toFixed(1)}% | ` +
    `total_in=${formatBytes(s.totalBytesIn)} total_out=${formatBytes(s.totalBytesOut)}`
  );
}, STATS_LOG_INTERVAL);

// Compression helpers based on mode
// Regular streaming - no padding needed
async function compress(data: Uint8Array): Promise<Uint8Array> {
  if (compressionMode === "zstd") {
    return zstdCompress(data);
  }
  if (compressionMode === "smaz") {
    return smazCompress(data);
  }
  return data; // none or deflate (deflate handled by WebSocket layer)
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  if (compressionMode === "zstd") {
    return zstdDecompress(data);
  }
  if (compressionMode === "smaz") {
    return smazDecompress(data);
  }
  return data; // none or deflate (deflate handled by WebSocket layer)
}

// Buffer replay - use padding for BREACH mitigation (attacker could probe)
async function compressForReplay(data: Uint8Array): Promise<Uint8Array> {
  if (compressionMode === "zstd") {
    return compressWithPadding(data);
  }
  if (compressionMode === "smaz") {
    return smazCompressWithPadding(data);
  }
  return data;
}

async function decompressFromBuffer(data: Uint8Array): Promise<Uint8Array> {
  if (compressionMode === "zstd") {
    return decompressWithPadding(data);
  }
  if (compressionMode === "smaz") {
    return smazDecompressWithPadding(data);
  }
  return data;
}

// For deflate mode, we pass true to ws.send() to enable per-message compression
function send(ws: any, data: string | Uint8Array) {
  if (compressionMode === "deflate") {
    ws.send(data, true);
  } else {
    ws.send(data);
  }
}

Bun.serve({
  port,
  fetch(req, server) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const remoteAddr = server.requestIP(req)?.address || "unknown";
    
    if (url.pathname === "/runner") {
      if (token !== TOKEN) {
        console.log(`[${timestamp()}] [Auth Failed] type=runner ip=${remoteAddr} reason=invalid_token`);
        return new Response("Unauthorized", { status: 401 });
      }
      const id = url.searchParams.get("id") || genId();
      if (server.upgrade(req, { data: { type: "runner", id, ip: remoteAddr } })) return;
    }
    
    if (url.pathname === "/ws") {
      if (token !== TOKEN) {
        console.log(`[${timestamp()}] [Auth Failed] type=viewer ip=${remoteAddr} reason=invalid_token`);
        return new Response("Unauthorized", { status: 401 });
      }
      const id = url.searchParams.get("id");
      if (!id) {
        console.log(`[${timestamp()}] [Bad Request] type=viewer ip=${remoteAddr} reason=missing_session_id`);
        return new Response("Missing session id", { status: 400 });
      }
      if (server.upgrade(req, { data: { type: "viewer", id, ip: remoteAddr } })) return;
    }
    
    // Serve static files with correct MIME types
    if (url.pathname === "/zstd.wasm") {
      return new Response(Bun.file("zstd.wasm"), {
        headers: { "Content-Type": "application/wasm" },
      });
    }
    
    if (url.pathname === "/zstd-wasm.esm.js") {
      return new Response(Bun.file("zstd-wasm.esm.js"), {
        headers: { "Content-Type": "application/javascript" },
      });
    }
    
    return new Response(Bun.file("viewer.html"));
  },
  websocket: {
    perMessageDeflate: compressionMode === "deflate",
    async open(ws) {
      const { type, id, ip } = ws.data as { type: string; id: string; ip: string };
      
      if (type === "runner") {
        const session: Session = { id, runner: ws, viewers: new Set(), framebuffer: new Framebuffer(), exited: false };
        sessions.set(id, session);
        ws.send(JSON.stringify({ type: "session", id, compression: compressionMode }));
        console.log(`[${timestamp()}] [Connect] type=runner ip=${ip} session=${id}`);
      } else {
        const session = sessions.get(id);
        if (!session) {
          console.log(`[${timestamp()}] [Rejected] type=viewer ip=${ip} session=${id} reason=session_not_found`);
          ws.close(4004, "Session not found");
          return;
        }
        session.viewers.add(ws);
        if (session.cleanupTimer) { clearTimeout(session.cleanupTimer); session.cleanupTimer = undefined; }
        console.log(`[${timestamp()}] [Connect] type=viewer ip=${ip} session=${id} viewers=${session.viewers.size}`);
        
        // Send compression mode to viewer
        ws.send(JSON.stringify({ type: "compression", mode: compressionMode }));
        
        // Send current framebuffer state as a snapshot
        const snapshot = session.framebuffer.serialize();
        const snapshotBytes = new TextEncoder().encode(snapshot);
        if (compressionMode === "zstd" || compressionMode === "smaz") {
          const compressed = await compress(snapshotBytes);
          send(ws, compressed);
        } else {
          send(ws, snapshotBytes);
        }
        
        // Signal ready for live streaming
        ws.send(JSON.stringify({ type: "ready" }));
      }
    },
    async message(ws, msg) {
      const { type, id } = ws.data as { type: string; id: string };
      const session = sessions.get(id);
      if (!session) return;
      
      if (type === "runner") {
        // Data from runner to viewers
        if (typeof msg === "string") {
          // JSON control messages (resize, exit)
          try {
            const parsed = JSON.parse(msg);
            if (parsed.type === "exit") session.exited = true;
            if (parsed.type === "resize" && parsed.cols && parsed.rows) {
              session.framebuffer.resize(parsed.cols, parsed.rows);
            }
          } catch {}
          for (const v of session.viewers) v.send(msg);
        } else {
          // Binary data - PTY output
          const data = msg instanceof ArrayBuffer ? new Uint8Array(msg) : new Uint8Array(msg);
          serverStats.recordInbound(data.byteLength);
          
          // Decompress to update framebuffer
          const decompressed = await decompress(data);
          session.framebuffer.write(decompressed);
          
          // Forward to viewers
          for (const v of session.viewers) {
            serverStats.recordOutbound(data.byteLength);
            send(v, data);
          }
        }
      } else if (session.runner) {
        // Data from viewer to runner
        if (typeof msg === "string") {
          session.runner.send(msg);
        } else {
          const data = msg instanceof ArrayBuffer ? new Uint8Array(msg) : new Uint8Array(msg);
          serverStats.recordInbound(data.byteLength);
          serverStats.recordOutbound(data.byteLength);
          send(session.runner, data);
        }
      }
    },
    close(ws, code, reason) {
      const { type, id, ip } = ws.data as { type: string; id: string; ip: string };
      const session = sessions.get(id);
      
      const reasonStr = reason ? ` reason="${reason}"` : "";
      
      if (!session) {
        console.log(`[${timestamp()}] [Disconnect] type=${type} ip=${ip} session=${id} code=${code}${reasonStr}`);
        return;
      }
      
      if (type === "runner") {
        session.runner = null;
        session.exited = true;
        scheduleCleanup(session);
        console.log(`[${timestamp()}] [Disconnect] type=runner ip=${ip} session=${id} code=${code}${reasonStr} viewers=${session.viewers.size}`);
      } else {
        session.viewers.delete(ws);
        scheduleCleanup(session);
        console.log(`[${timestamp()}] [Disconnect] type=viewer ip=${ip} session=${id} code=${code}${reasonStr} viewers=${session.viewers.size}`);
      }
    },
  },
});

console.log(`[${timestamp()}] [Server Started] port=${port} compression=${compressionMode} token=${TOKEN === "secret" ? "(default)" : "(custom)"}`);
console.log(`[${timestamp()}] [Server Started] http://localhost:${port}`);
