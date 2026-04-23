# API Key Authentication for MCP

This server supports dual authentication for the MCP endpoint:
1. **Session-based auth** (for web UI)
2. **API key auth** (for MCP clients)

## Creating an API Key

1. **Sign in** to get a session (or use the seeded admin account)
2. **Create an API key** via POST to `/auth/tokens`:

```bash
curl -X POST http://localhost:3000/auth/tokens \
  -H "Content-Type: application/json" \
  -d '{"name": "My MCP Client"}' \
  --cookie "better_auth.session_token=<your-session-token>"
```

Response:
```json
{
  "id": "...",
  "key": "bf_<32-hex-chars>",
  "warning": "Save this key securely. It will not be shown again and cannot be recovered."
}
```

**Important**: Save the `key` value immediately - it cannot be retrieved later!

## Using an API Key with MCP

Configure your MCP client to send the API key in the Authorization header:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer bf_<your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize",...}'
```

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bonfire": {
      "command": "node",
      "args": ["/path/to/mcp-proxy.js"],
      "env": {
        "BONFIRE_URL": "http://localhost:3000/mcp",
        "BONFIRE_API_KEY": "bf_<your-api-key>"
      }
    }
  }
}
```

Where `mcp-proxy.js` is a simple wrapper that adds the Authorization header:

```javascript
import { spawn } from 'child_process';

const apiKey = process.env.BONFIRE_API_KEY;
const url = process.env.BONFIRE_URL;

// Proxy stdin/stdout while adding auth header
// Implementation depends on your MCP transport setup
```

## Managing API Keys

### List your API keys

```bash
curl http://localhost:3000/auth/tokens \
  --cookie "better_auth.session_token=<your-session-token>"
```

### Delete an API key

```bash
curl -X DELETE http://localhost:3000/auth/tokens/<key-id> \
  --cookie "better_auth.session_token=<your-session-token>"
```

## Security Notes

- API keys are hashed (SHA-256) before storage
- Keys are prefixed with `bf_` for easy identification
- Last used timestamp is tracked on each request
- Optional expiry can be added in future versions
- Each user can only manage their own API keys
