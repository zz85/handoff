const TOKEN = process.env.HANDOFF_TOKEN || "secret";
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

const words = ["apple", "banana", "cherry", "delta", "eagle", "forest", "grape", "harbor", "island", "jungle", "kite", "lemon", "mango", "north", "ocean", "palm", "quartz", "river", "storm", "tiger"];
const genId = () => words[Math.random() * words.length | 0] + "-" + words[Math.random() * words.length | 0] + "-" + words[Math.random() * words.length | 0];

interface Session {
  id: string;
  runner: any;
  viewers: Set<any>;
  buffer: any[];
  exited: boolean;
  cleanupTimer?: Timer;
}

const sessions = new Map<string, Session>();

function scheduleCleanup(session: Session) {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  if (session.exited && session.viewers.size === 0) {
    session.cleanupTimer = setTimeout(() => sessions.delete(session.id), SESSION_TTL);
  }
}

Bun.serve({
  port: 3000,
  fetch(req, server) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    
    if (url.pathname === "/runner") {
      if (token !== TOKEN) return new Response("Unauthorized", { status: 401 });
      const id = url.searchParams.get("id") || genId();
      if (server.upgrade(req, { data: { type: "runner", id } })) return;
    }
    
    if (url.pathname === "/ws") {
      if (token !== TOKEN) return new Response("Unauthorized", { status: 401 });
      const id = url.searchParams.get("id");
      if (!id) return new Response("Missing session id", { status: 400 });
      if (server.upgrade(req, { data: { type: "viewer", id } })) return;
    }
    
    return new Response(Bun.file("viewer.html"));
  },
  websocket: {
    open(ws) {
      const { type, id } = ws.data;
      if (type === "runner") {
        const session: Session = { id, runner: ws, viewers: new Set(), buffer: [], exited: false };
        sessions.set(id, session);
        ws.send(JSON.stringify({ type: "session", id }));
      } else {
        const session = sessions.get(id);
        if (!session) { ws.close(4004, "Session not found"); return; }
        session.viewers.add(ws);
        if (session.cleanupTimer) { clearTimeout(session.cleanupTimer); session.cleanupTimer = undefined; }
        for (const chunk of session.buffer) ws.send(chunk);
      }
    },
    message(ws, msg) {
      const { type, id } = ws.data;
      const session = sessions.get(id);
      if (!session) return;
      
      if (type === "runner") {
        session.buffer.push(msg);
        if (typeof msg === "string") {
          try { if (JSON.parse(msg).type === "exit") session.exited = true; } catch {}
        }
        for (const v of session.viewers) v.send(msg);
      } else if (session.runner) {
        session.runner.send(msg);
      }
    },
    close(ws) {
      const { type, id } = ws.data;
      const session = sessions.get(id);
      if (!session) return;
      
      if (type === "runner") {
        session.runner = null;
        session.exited = true;
        scheduleCleanup(session);
      } else {
        session.viewers.delete(ws);
        scheduleCleanup(session);
      }
    },
  },
});

console.log("Server running at http://localhost:3000");
