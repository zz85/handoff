# Handoff

Monitor and interact with long-running terminal tasks while away from your desk.

Requires Bun 1.3+. Run `bun upgrade` to get the latest version.

## Usage

Start the server:
```bash
bun handoff.ts serve
bun handoff.ts serve --port=8080
bun handoff.ts serve --compression=smaz
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
- `HANDOFF_COMPRESSION` - Compression mode: none, zstd, deflate, smaz (default: "zstd")

## Compression modes

| Mode | Best for | Notes |
|------|----------|-------|
| `zstd` | Large outputs | Best ratio for big payloads, random padding for BREACH mitigation |
| `smaz` | Terminal sessions | Optimized for small ASCII strings, good for interactive use |
| `deflate` | Compatibility | WebSocket per-message deflate (built-in, lower overhead) |
| `none` | Debugging | No compression |
