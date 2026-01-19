# Handoff

Monitor and interact with long-running terminal tasks while away from your desk.

## Usage

Start the server:
```bash
bun handoff.ts serve
bun handoff.ts serve --port=8080
```

Run a command:
```bash
bun handoff.ts <command> [args...]
bun handoff.ts vim myfile.txt
bun handoff.ts htop
```

View in browser:
```
http://localhost:3000/?id=<session-id>
```

Environment variables:
- `HANDOFF_TOKEN` - Auth token (default: "secret")
- `HANDOFF_SERVER` - Server URL for runner (default: "ws://localhost:3000")
- `HANDOFF_PORT` - Server listen port (default: 3000)

Features zstd compression and token-based auth with BREACH mitigation.
