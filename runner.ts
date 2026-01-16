import { spawn } from "bun";
import { appendFileSync } from "fs";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Usage: bun runner.ts <command> [args...]");
  process.exit(1);
}

const logFile = "output.log";

const proc = spawn([cmd, ...args], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
});

proc.stdout.pipeTo(new WritableStream({
  write(chunk) {
    const text = new TextDecoder().decode(chunk);
    process.stdout.write(text);
    appendFileSync(logFile, text);
  }
}));

proc.stderr.pipeTo(new WritableStream({
  write(chunk) {
    const text = new TextDecoder().decode(chunk);
    process.stderr.write(text);
    appendFileSync(logFile, text);
  }
}));

process.stdin.on("data", (data) => proc.stdin.write(data));

const code = await proc.exited;
process.exit(code);
