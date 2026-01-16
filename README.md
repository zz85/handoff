# Handoff

A terminal sharing tool that streams PTY output to web viewers via WebSocket.

## Environment Variables

- `HANDOFF_TOKEN` - Auth token (default: "secret")
- `HANDOFF_SERVER` - Server URL for handoff client (default: "ws://localhost:3000")

## Usage

1. Start the server:
```bash
HANDOFF_TOKEN=mytoken bun run server.ts
```

2. Start a session:
```bash
HANDOFF_TOKEN=mytoken bun run handoff.ts <command>
# Prints: [Session ID: apple-banana-cherry]
```

3. View in browser:
```
http://localhost:3000/?id=apple-banana-cherry&token=mytoken
```

## Features

- PTY support (colors, cursor movement, interactive programs)
- Multiple viewers per session
- Session buffer replay for late joiners
- Auto-cleanup 30 minutes after process exits
- Input controls (y/n/t, Ctrl-C, Esc, arrow keys, backspace)
