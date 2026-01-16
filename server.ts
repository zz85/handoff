const viewers = new Set<any>();
let runnerWs: any = null;
let buffer: Uint8Array[] = [];

Bun.serve({
  port: 3000,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws" && server.upgrade(req, { data: { type: "viewer" } })) return;
    if (url.pathname === "/runner" && server.upgrade(req, { data: { type: "runner" } })) return;
    const file = url.pathname === "/xterm" ? "xterm-test.html" : "termino-test.html";
    return new Response(Bun.file(file));
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
        if (msg instanceof ArrayBuffer) buffer.push(new Uint8Array(msg));
        else if (msg instanceof Uint8Array) buffer.push(msg);
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
