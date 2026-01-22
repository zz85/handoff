# Handoff

Monitor and interact with long-running terminal tasks while away from your desk.

Requires Bun 1.3+. Run `bun upgrade` to get the latest version.

## Quick Start

```bash
# Run a command with integrated server (simplest)
bun handoff.ts vim myfile.txt

# Opens server on port 3000, prints URL to connect
```

## Usage Modes

### Integrated Mode (recommended)

Run a command with an integrated server - no separate server process needed:

```bash
bun handoff.ts <command> [args...]
bun handoff.ts --port=8080 vim file.txt
bun handoff.ts --compression=smaz htop
```

### Standalone Server

Start a relay server separately, then connect runners to it:

```bash
# Terminal 1: Start server
bun handoff.ts serve --port=3000

# Terminal 2: Run command
bun handoff.ts --connect=localhost:3000 vim file.txt
```

### Connect to Remote Server

Connect to a remote handoff server:

```bash
bun handoff.ts --connect=ws://remote-host:3000 --token=mytoken htop
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port=PORT` | Server port | 3000 |
| `--compression=MODE` | Compression mode | deflate |
| `--connect=URL` | Connect to remote server | (local) |
| `--token=TOKEN` | Auth token | "secret" |

## Environment Variables

- `HANDOFF_TOKEN` - Auth token (default: "secret")
- `HANDOFF_SERVER` - Server URL for connect mode
- `HANDOFF_PORT` - Server listen port (default: 3000)
- `HANDOFF_COMPRESSION` - Compression mode (default: "deflate")

## Compression Modes

| Mode | Best for | Notes |
|------|----------|-------|
| `deflate` | General use | WebSocket per-message deflate, low overhead (default) |
| `smaz` | Terminal sessions | Optimized for small ASCII strings |
| `zstd` | Large outputs | Best ratio for big payloads, BREACH mitigation |
| `none` | Debugging | No compression |

## Viewing Sessions

Open in browser:
```
http://localhost:3000/?id=<session-id>&token=<token>
```

The integrated mode prints the full URL when starting.
