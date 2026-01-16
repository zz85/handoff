const viewers = new Set<any>();
let runnerWs: any = null;
let buffer: any[] = [];

Bun.serve({
  port: 3000,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws" && server.upgrade(req, { data: { type: "viewer" } })) return;
    if (url.pathname === "/runner" && server.upgrade(req, { data: { type: "runner" } })) return;
    return new Response(Bun.file("viewer.html"));
  },
  websocket: {
    open(ws) {
      if (ws.data.type === "runner") {
        runnerWs = ws;
        buffer = [];
      } else {
        viewers.add(ws);
        for (const chunk of buffer) ws.send(chunk);
      }
    },
    message(ws, msg) {
      if (ws.data.type === "runner") {
        buffer.push(msg);
        for (const v of viewers) v.send(msg);
      } else if (runnerWs) {
        runnerWs.send(msg);
      }
    },
    close(ws) {
      if (ws.data.type === "runner") runnerWs = null;
      else viewers.delete(ws);
    },
  },
});

console.log("Server running at http://localhost:3000");
