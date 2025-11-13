# Configuration

Configure Code to match your preferences and workflow.

## Configuration File

Code uses a multi-tier configuration system with environment variables, config files, and runtime options.

### Configuration Locations

**User Config:**
```
~/.sylphx-code/config.json
```

**Project Config:**
```
./.sylphx-code/config.json
```

**Priority Order:**
1. Runtime options (highest priority)
2. Environment variables
3. Project config
4. User config
5. Default values (lowest priority)

## AI Providers

### OpenRouter (Recommended)

Access 200+ AI models through a single API.

**Setup:**
```bash
export OPENROUTER_API_KEY=your-key-here
```

**Config file:**
```json
{
  "ai": {
    "provider": "openrouter",
    "model": "anthropic/claude-3.5-sonnet",
    "apiKey": "sk-or-..."
  }
}
```

**Available Models:**
- `anthropic/claude-3-opus` - Most capable
- `anthropic/claude-3.5-sonnet` - Balanced (recommended)
- `anthropic/claude-3-haiku` - Fast and efficient
- `openai/gpt-4-turbo` - OpenAI flagship
- `openai/gpt-3.5-turbo` - Fast and cheap
- `google/gemini-pro` - Google's model
- `meta-llama/llama-3-70b` - Open source
- Many more...

**Pricing:**
OpenRouter uses pay-as-you-go with competitive pricing.

### Anthropic Claude

Direct access to Claude models.

**Setup:**
```bash
export ANTHROPIC_API_KEY=your-key-here
```

**Config:**
```json
{
  "ai": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022"
  }
}
```

**Models:**
- `claude-3-opus-20240229` - Most intelligent
- `claude-3-5-sonnet-20241022` - Best balance (recommended)
- `claude-3-haiku-20240307` - Fastest

### OpenAI

Access GPT models directly.

**Setup:**
```bash
export OPENAI_API_KEY=your-key-here
```

**Config:**
```json
{
  "ai": {
    "provider": "openai",
    "model": "gpt-4-turbo-preview"
  }
}
```

**Models:**
- `gpt-4-turbo-preview` - Latest GPT-4
- `gpt-4` - Standard GPT-4
- `gpt-3.5-turbo` - Fast and cheap

### Google Gemini

Google's Gemini models.

**Setup:**
```bash
export GOOGLE_API_KEY=your-key-here
```

**Config:**
```json
{
  "ai": {
    "provider": "google",
    "model": "gemini-pro"
  }
}
```

**Models:**
- `gemini-pro` - Standard model
- `gemini-pro-vision` - With vision capabilities

### Custom Provider

Add your own AI provider:

```json
{
  "ai": {
    "provider": "custom",
    "endpoint": "https://your-api.com/v1",
    "apiKey": "your-key",
    "model": "your-model"
  }
}
```

## Model Parameters

Fine-tune AI behavior:

```json
{
  "ai": {
    "model": "claude-3-5-sonnet-20241022",
    "temperature": 0.7,
    "maxTokens": 4096,
    "topP": 0.9,
    "topK": 50,
    "streaming": true
  }
}
```

**Parameters:**

- **temperature** (0.0-2.0) - Randomness in responses
  - `0.0` - Deterministic, focused
  - `0.7` - Balanced (default)
  - `1.5` - Creative, varied

- **maxTokens** - Maximum response length
  - `1024` - Short responses
  - `4096` - Standard (default)
  - `8192` - Long responses

- **topP** (0.0-1.0) - Nucleus sampling
  - `0.9` - More focused (default)
  - `1.0` - Full vocabulary

- **topK** - Limit vocabulary choices
  - `50` - Standard (default)
  - `100` - More varied

- **streaming** - Enable real-time streaming
  - `true` - Stream responses (default)
  - `false` - Wait for complete response

## Database Configuration

Configure session persistence:

```json
{
  "database": {
    "path": "~/.sylphx-code/data/sessions.db",
    "autoMigrate": true,
    "backupEnabled": true,
    "backupInterval": 86400
  }
}
```

**Options:**

- **path** - Database file location
- **autoMigrate** - Run migrations automatically
- **backupEnabled** - Enable automatic backups
- **backupInterval** - Backup interval in seconds (default: 24 hours)

## UI Configuration

### Terminal UI Settings

```json
{
  "tui": {
    "theme": "dark",
    "vim_mode": true,
    "autocomplete": true,
    "notifications": true,
    "stats": true
  }
}
```

**Options:**

- **theme** - Color scheme (`dark` | `light`)
- **vim_mode** - Enable Vim keybindings
- **autocomplete** - Enable smart autocomplete
- **notifications** - Enable OS notifications
- **stats** - Show real-time statistics

### Web UI Settings

```json
{
  "web": {
    "port": 3001,
    "theme": "auto",
    "animations": true
  }
}
```

**Options:**

- **port** - Web server port
- **theme** - Theme mode (`auto` | `dark` | `light`)
- **animations** - Enable UI animations

## Server Configuration

### Daemon Mode

```json
{
  "server": {
    "port": 3000,
    "host": "0.0.0.0",
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3001"]
    }
  }
}
```

**Options:**

- **port** - Server port
- **host** - Bind address (`0.0.0.0` for all interfaces)
- **cors.enabled** - Enable CORS
- **cors.origins** - Allowed origins

### Event Stream

```json
{
  "eventStream": {
    "bufferSize": 100,
    "bufferTime": 300000,
    "cleanupInterval": 60000
  }
}
```

**Options:**

- **bufferSize** - Number of events to buffer (default: 100)
- **bufferTime** - Buffer retention time in ms (default: 5 minutes)
- **cleanupInterval** - Cleanup interval in ms (default: 1 minute)

## Tool Configuration

Configure built-in tools:

```json
{
  "tools": {
    "bash": {
      "timeout": 120000,
      "maxConcurrent": 5
    },
    "file": {
      "maxSize": 5242880,
      "allowedExtensions": [".ts", ".js", ".json", ".md"]
    },
    "notifications": {
      "enabled": true,
      "sound": true
    }
  }
}
```

**Bash Tool:**
- **timeout** - Command timeout in ms (default: 2 minutes)
- **maxConcurrent** - Max concurrent commands (default: 5)

**File Tool:**
- **maxSize** - Max file size in bytes (default: 5MB)
- **allowedExtensions** - File type whitelist

**Notifications:**
- **enabled** - Enable OS notifications
- **sound** - Play notification sound

## Debug Configuration

Configure logging and debugging:

```json
{
  "debug": {
    "enabled": true,
    "namespaces": ["sylphx:stream:*", "sylphx:tool:*"],
    "logFile": "~/.sylphx-code/logs/debug.log"
  }
}
```

**Options:**

- **enabled** - Enable debug logging
- **namespaces** - Debug namespaces (array of patterns)
- **logFile** - Log file path (optional)

**Environment Variable:**
```bash
DEBUG=sylphx:* bun dev:code
```

## Environment Variables

All configuration can be set via environment variables:

```bash
# AI Provider
export CODE_AI_PROVIDER=openrouter
export CODE_AI_MODEL=anthropic/claude-3.5-sonnet
export OPENROUTER_API_KEY=your-key

# Server
export CODE_SERVER_PORT=3000
export CODE_SERVER_HOST=0.0.0.0

# Database
export CODE_DATABASE_PATH=~/.sylphx-code/data/sessions.db

# Debug
export DEBUG=sylphx:*
```

**Priority:**
Environment variables override config file settings.

## Example Configurations

### Development Setup

```json
{
  "ai": {
    "provider": "openrouter",
    "model": "anthropic/claude-3-haiku",
    "temperature": 0.7
  },
  "debug": {
    "enabled": true,
    "namespaces": ["sylphx:*"]
  },
  "tui": {
    "vim_mode": true,
    "autocomplete": true
  }
}
```

### Production Setup

```json
{
  "ai": {
    "provider": "anthropic",
    "model": "claude-3-5-sonnet-20241022",
    "temperature": 0.5,
    "maxTokens": 4096
  },
  "server": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "database": {
    "backupEnabled": true,
    "backupInterval": 43200
  },
  "debug": {
    "enabled": false
  }
}
```

### Performance Optimized

```json
{
  "ai": {
    "provider": "openrouter",
    "model": "anthropic/claude-3-haiku",
    "maxTokens": 2048,
    "streaming": true
  },
  "eventStream": {
    "bufferSize": 50,
    "bufferTime": 60000
  },
  "tools": {
    "bash": {
      "timeout": 60000,
      "maxConcurrent": 3
    }
  }
}
```

### Cost Optimized

```json
{
  "ai": {
    "provider": "openrouter",
    "model": "openai/gpt-3.5-turbo",
    "temperature": 0.7,
    "maxTokens": 1024
  },
  "eventStream": {
    "bufferSize": 25,
    "bufferTime": 30000
  }
}
```

## Configuration Management

### View Current Configuration

```bash
# From code (coming soon)
/config show
```

### Update Configuration

**Via file:**
```bash
# Edit user config
nano ~/.sylphx-code/config.json

# Edit project config
nano ./.sylphx-code/config.json
```

**Via command (coming soon):**
```bash
/config set ai.model claude-3-opus
/config set ai.temperature 0.8
```

### Reset to Defaults

```bash
# Remove config files
rm ~/.sylphx-code/config.json
rm ./.sylphx-code/config.json

# Restart Code
bun dev:code
```

## Best Practices

### Security

- **Never commit API keys** to version control
- Use environment variables for sensitive data
- Restrict server host to `127.0.0.1` if local-only
- Use `.gitignore` for config files with secrets

### Performance

- Use faster models for simple tasks (Claude Haiku, GPT-3.5)
- Reduce buffer sizes if memory is limited
- Disable debug logging in production
- Set appropriate tool timeouts

### Cost Management

- Monitor token usage with `/stats`
- Use cheaper models when appropriate
- Set reasonable `maxTokens` limits
- Compact sessions regularly

### Development

- Enable debug logging for troubleshooting
- Use separate configs for dev/prod
- Test with fast models first
- Keep backups enabled

## Troubleshooting

### API Key Issues

**Not found:**
```bash
# Check environment
echo $OPENROUTER_API_KEY

# Set if missing
export OPENROUTER_API_KEY=your-key
```

### Configuration Not Loading

**Check file location:**
```bash
ls -la ~/.sylphx-code/config.json
```

**Validate JSON:**
```bash
cat ~/.sylphx-code/config.json | jq .
```

### Performance Issues

**Reduce buffer sizes:**
```json
{
  "eventStream": {
    "bufferSize": 25,
    "bufferTime": 60000
  }
}
```

**Use faster models:**
```json
{
  "ai": {
    "model": "anthropic/claude-3-haiku"
  }
}
```

## Next Steps

- [Usage Guide](/guide/usage) - Learn how to use Code
- [Architecture](/architecture/) - Understand the system
- [Development](/development/) - Contribute to Code

## Resources

- 📖 [Configuration Schema](https://github.com/SylphxAI/code/blob/main/packages/code-core/src/config/schema.ts)
- 🐛 [Report Issues](https://github.com/SylphxAI/code/issues)
