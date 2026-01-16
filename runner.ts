import { spawn } from "bun";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Usage: bun runner.ts <command> [args...]");
  process.exit(1);
}

const ws = new WebSocket("ws://localhost:3000/runner");

const proc = spawn([cmd, ...args], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "resize", cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 }));

  proc.stdout.pipeTo(new WritableStream({
    write(chunk) {
      process.stdout.write(chunk);
      ws.send(chunk);
    }
  }));

  proc.stderr.pipeTo(new WritableStream({
    write(chunk) {
      process.stderr.write(chunk);
      ws.send(chunk);
    }
  }));
};

ws.onmessage = (e) => proc.stdin.write(e.data);

const code = await proc.exited;
ws.close();
process.exit(code);
