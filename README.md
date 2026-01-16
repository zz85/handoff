# Handoff

Monitor and interact with long-running terminal tasks while away from your desk.

## How It Works

1. **handoff.ts** - Client that wraps a command in a PTY and connects to the server
2. **server.ts** - Bun WebSocket server that routes data between runners and viewers
3. **viewer.html** - Browser-based terminal with xterm.js and input controls

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

## Environment Variables

- `HANDOFF_TOKEN` - Auth token (default: "secret")
- `HANDOFF_SERVER` - Server URL for handoff client (default: "ws://localhost:3000")

## Features

- Full PTY support (colors, cursor movement, interactive programs)
- Multiple viewers per session
- Session buffer replay for late joiners
- Auto-cleanup 30 minutes after process exits
- Input controls (y/n/t, Ctrl-C, Esc, arrow keys, backspace, custom text)
