const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Usage: bun runner.ts <command> [args...]");
  process.exit(1);
}

const ws = new WebSocket("ws://localhost:3000/runner");

const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "resize", cols, rows }));

  const proc = Bun.spawn([cmd, ...args], {
    terminal: {
      cols,
      rows,
      data(term, data) {
        process.stdout.write(data);
        ws.send(data);
      },
    },
  });

  ws.onmessage = (e) => proc.terminal.write(e.data);

  proc.exited.then((code) => {
    ws.send(JSON.stringify({ type: "exit", code }));
    proc.terminal.close();
    ws.close();
    process.exit(code);
  });
};

process.stdout.on("resize", () => {
  ws.send(JSON.stringify({ type: "resize", cols: process.stdout.columns, rows: process.stdout.rows }));
});
