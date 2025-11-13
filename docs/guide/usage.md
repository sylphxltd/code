# Usage Guide

Learn how to use Code effectively for AI-assisted development.

## Interface Overview

### Terminal UI (TUI)

The Terminal UI is built with Ink and features a Vim-inspired interface.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  Sessions    │  Chat Area                           │
│  Sidebar     │                                       │
│              │  Messages & AI Responses             │
│  + New       │                                       │
│  Session 1   │  Tool executions                     │
│  Session 2   │                                       │
│              │                                       │
│              │                                       │
├─────────────────────────────────────────────────────┤
│  Input: Type your message...                        │
└─────────────────────────────────────────────────────┘
```

**Keyboard Shortcuts:**
- `Ctrl+C` - Exit
- `Tab` - Switch focus
- `↑/↓` - Navigate sessions
- `Enter` - Select/Send
- `/` - Open command palette

### Web UI

The Web UI is built with React and Next.js.

**Features:**
- Modern, responsive design
- Multi-tab support
- Real-time synchronization with TUI
- Mobile-friendly interface

## Basic Usage

### Starting a Conversation

**Terminal UI:**
1. Launch Code: `bun dev:code`
2. Type your message in the input area
3. Press `Enter` to send
4. Watch the AI respond in real-time

**Web UI:**
1. Launch Web UI: `bun dev:web`
2. Open browser to `http://localhost:3001`
3. Type in the chat input
4. Click Send or press `Enter`

### Creating Sessions

**Create a new session:**
- TUI: Press `+` in sidebar or use `/new` command
- Web: Click "New Session" button
- Both interfaces automatically sync

**Session Features:**
- Automatic title generation
- Message history persistence
- Context preservation
- Multi-client synchronization

### Sending Messages

**Text messages:**
```
> Explain how async/await works in JavaScript
```

**Code questions:**
```
> How can I optimize this React component?
[Paste your code]
```

**File operations:**
```
> Read the file at /path/to/file.ts and explain what it does
```

## AI Tools

Code includes 10+ built-in tools that the AI can use automatically.

### File Operations

**read** - Read file contents
```
User: What's in the main.ts file?
AI: [Uses read tool to read file]
```

**write** - Create or overwrite files
```
User: Create a new TypeScript config
AI: [Uses write tool to create tsconfig.json]
```

**edit** - Edit existing files with smart diffing
```
User: Add error handling to the fetchData function
AI: [Uses edit tool to modify specific lines]
```

### Search Tools

**glob** - Find files by pattern
```
User: Find all TypeScript test files
AI: [Uses glob with pattern **/*.test.ts]
```

**grep** - Search file contents
```
User: Find where the User interface is defined
AI: [Uses grep to search for "interface User"]
```

### Shell Commands

**bash** - Execute shell commands
```
User: Install the lodash package
AI: [Uses bash to run npm install lodash]
```

**output** - Monitor background shell output
```
User: Check if the build finished
AI: [Uses output to check build progress]
```

**kill** - Terminate background processes
```
User: Stop the running server
AI: [Uses kill to terminate process]
```

### User Input

**ask-user-selection** - Ask for choices
```
AI: Which framework would you like to use?
[Presents options: React, Vue, Angular]
User: [Selects option]
```

### Project Management

**todo** - Create and track tasks
```
User: Help me set up a new API endpoint
AI: [Creates todo list with steps]
```

**notification** - Send OS notifications
```
AI: [Sends notification when long task completes]
```

## Slash Commands

Access powerful commands with `/`:

### Session Management

**/new** - Create new session
```
/new
```

**/delete** - Delete current session
```
/delete
```

**/compact** - Compress session history
```
/compact
```
Generates summary and creates new session with context preserved.

### Configuration

**/model** - Switch AI model
```
/model gpt-4
/model claude-3-sonnet
```

**/provider** - Switch AI provider
```
/provider openai
/provider anthropic
```

### Information

**/stats** - Show statistics
```
/stats
```
Displays token usage, message counts, session info.

**/help** - Show available commands
```
/help
```

## Real-time Streaming

Code streams AI responses in real-time with visual feedback.

### Text Streaming

Watch AI responses appear token by token:
```
User: Explain React hooks

AI: React hooks are functions that...
    [streaming continues...]
```

### Tool Execution

See tools execute with real-time feedback:
```
AI: I'll read the file for you...

🔧 read_file
   ├─ file: /path/to/file.ts
   ├─ status: executing...
   ├─ status: complete ✅
   └─ duration: 15ms
```

### Reasoning Display

Some models show reasoning process:
```
AI: [Thinking] Let me analyze the code...
    - First, I need to understand the structure
    - Then identify performance bottlenecks
    - Finally suggest optimizations

[Response] Here's what I found...
```

## Multi-Client Synchronization

Changes in one client instantly appear in all others.

### Synchronized Actions

**Send message in TUI → See in Web:**
1. Type message in TUI
2. Web UI updates in real-time
3. Same for tool executions

**Create session in Web → See in TUI:**
1. Click "New Session" in Web
2. TUI sidebar updates immediately
3. Both clients stay synchronized

### Session Switching

**Switch to active streaming:**
1. Client A streams AI response
2. Client B switches to same session
3. Client B immediately sees ongoing stream

## Configuration

### AI Provider Setup

**OpenRouter (Recommended):**
1. Get API key from [openrouter.ai](https://openrouter.ai)
2. Set environment variable:
   ```bash
   export OPENROUTER_API_KEY=your-key
   ```
3. Use 200+ models

**Anthropic Claude:**
```bash
export ANTHROPIC_API_KEY=your-key
```

**OpenAI:**
```bash
export OPENAI_API_KEY=your-key
```

**Google Gemini:**
```bash
export GOOGLE_API_KEY=your-key
```

### Model Selection

Switch models on the fly:
```
/model gpt-4-turbo
/model claude-3-opus
/model gemini-pro
```

### Debug Logging

Enable detailed logging:
```bash
# All logs
DEBUG=sylphx:* bun dev:code

# Streaming only
DEBUG=sylphx:stream:* bun dev:code

# Subscriptions only
DEBUG=sylphx:subscription:* bun dev:code

# Multiple namespaces
DEBUG=sylphx:stream:*,sylphx:tool:* bun dev:code
```

## Best Practices

### Effective Prompting

**Be specific:**
❌ "Fix this code"
✅ "Add null checks to the getUserData function"

**Provide context:**
❌ "Add a feature"
✅ "Add user authentication using JWT tokens, similar to how we handle API keys"

**Break down complex tasks:**
❌ "Build a complete API"
✅ "First create the user model, then add CRUD endpoints, then add authentication"

### Session Management

**Use compact for long conversations:**
- Compact preserves context while reducing tokens
- Automatically triggers new AI response
- Saves costs on long sessions

**Create sessions for different tasks:**
- Separate sessions for different features
- Easier to find specific conversations
- Better context isolation

### Performance Optimization

**Close unused sessions:**
- Reduces memory usage
- Improves responsiveness
- Cleans up event streams

**Monitor token usage:**
- Use `/stats` to check usage
- Compact sessions when needed
- Choose appropriate models

## Troubleshooting

### Common Issues

**AI not responding:**
- Check API key is set
- Verify internet connection
- Check debug logs: `DEBUG=sylphx:* bun dev:code`

**Slow responses:**
- Check model selection (some models are slower)
- Verify network connection
- Monitor system resources

**Sync issues between clients:**
- Check both clients are on same session
- Verify event stream is running
- Restart clients if needed

**Tool execution failures:**
- Check file permissions
- Verify paths are correct
- Check debug logs for errors

### Getting Logs

**View all logs:**
```bash
DEBUG=sylphx:* bun dev:code 2>&1 | tee code.log
```

**Filter specific issues:**
```bash
DEBUG=sylphx:error:*,sylphx:stream:error:* bun dev:code
```

## Advanced Usage

### Custom Tools

Add your own tools by extending the core:
```typescript
// Coming soon: Plugin system
```

### Daemon Mode

Run Code as a background service:
```bash
PORT=3000 bun --cwd packages/code-server start
```

Connect multiple clients:
```bash
# Terminal 1
CODE_SERVER=http://localhost:3000 bun dev:code

# Terminal 2
CODE_SERVER=http://localhost:3000 bun dev:code
```

### Programmatic Usage

Use Code as a library:
```typescript
import { createClient } from '@sylphx/code-client';

const client = createClient();
const response = await client.message.streamResponse.subscribe({
  sessionId: 'session-123',
  content: [{ type: 'text', content: 'Hello' }]
});
```

## Next Steps

- [Configuration Guide](/guide/configuration) - Detailed configuration options
- [Architecture](/architecture/) - Learn how Code works
- [Development](/development/) - Contribute to Code

## Resources

- 📖 [API Reference](/api/) - Complete API documentation
- 🐛 [Report Issues](https://github.com/SylphxAI/code/issues)
- 💬 [Discussions](https://github.com/SylphxAI/code/discussions)
