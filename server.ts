import { readFileSync, watchFile } from "fs";

const logPath = "./output.log";

Bun.serve({
  port: 3000,
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws" && server.upgrade(req)) return;
    const file = url.pathname === "/xterm" ? "xterm-test.html" : "termino-test.html";
    return new Response(Bun.file(file));
  },
  websocket: {
    open(ws) {
      ws.send(readFileSync(logPath, "utf-8"));
      watchFile(logPath, () => ws.send(readFileSync(logPath, "utf-8")));
    },
    message() {},
  },
});

console.log("Server running at http://localhost:3000");
