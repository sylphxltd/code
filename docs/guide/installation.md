# Installation

This guide covers detailed installation instructions for Code on different platforms and deployment scenarios.

## System Requirements

### Minimum Requirements

- **OS**: macOS, Linux, or WSL2 (Windows)
- **RAM**: 4GB minimum, 8GB recommended
- **Disk Space**: 500MB for installation
- **Bun**: >= 1.3.1
- **Node.js**: >= 18 (for compatibility with some dependencies)

### Recommended Requirements

- **OS**: macOS or Linux
- **RAM**: 16GB for better AI model performance
- **Disk Space**: 2GB for sessions and cached data
- **Bun**: Latest stable version
- **Terminal**: Modern terminal with Unicode support

## Installation Methods

### Method 1: From Source (Recommended)

This is the recommended method for development and staying up-to-date.

#### 1. Install Bun

**macOS and Linux:**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows (WSL2):**
```bash
curl -fsSL https://bun.sh/install | bash
```

#### 2. Clone Repository

```bash
git clone https://github.com/SylphxAI/code.git
cd code
```

#### 3. Install Dependencies

```bash
bun install
```

This will:
- Install all workspace dependencies
- Set up internal package links
- Prepare the development environment

#### 4. Build All Packages

```bash
bun run build
```

Build output:
- ✅ `@sylphx/code-core` built in ~75ms
- ✅ `@sylphx/code-server` built in ~23ms
- ✅ `@sylphx/code-client` built in ~39ms
- ✅ `@sylphx/code` (TUI) built in ~40ms

#### 5. Verify Installation

```bash
# Test Terminal UI
bun dev:code

# Test Web UI (in another terminal)
bun dev:web
```

### Method 2: NPM Package (Coming Soon)

```bash
# Global installation (not yet available)
npm install -g @sylphx/code

# Run directly
code
```

## Platform-Specific Notes

### macOS

Code works best on macOS with native terminal applications like iTerm2 or Terminal.app.

**Additional setup:**
- Grant terminal permissions for notifications (System Preferences → Notifications)
- Allow terminal to access files (System Preferences → Privacy → Files and Folders)

### Linux

Most Linux distributions work out of the box.

**Ubuntu/Debian:**
```bash
# Install Node.js if needed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Bun
curl -fsSL https://bun.sh/install | bash
```

**Arch Linux:**
```bash
# Install Node.js
sudo pacman -S nodejs npm

# Install Bun
curl -fsSL https://bun.sh/install | bash
```

### Windows (WSL2)

Code requires WSL2 on Windows. Native Windows support is planned.

**Setup WSL2:**
```bash
# In PowerShell (as Administrator)
wsl --install
```

**Install in WSL2:**
```bash
# Inside WSL2
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/SylphxAI/code.git
cd code
bun install
bun run build
```

## Running as a Daemon

Code can run as a background daemon to serve multiple clients over HTTP.

### Manual Start

```bash
# Start daemon on port 3000
PORT=3000 bun --cwd packages/code-server start
```

The daemon accepts connections from:
- TUI clients (HTTP/SSE)
- Web UI (HTTP/SSE)
- Future VSCode extension
- Custom clients via HTTP API

### systemd (Linux)

Create `/etc/systemd/system/code-daemon.service`:

```ini
[Unit]
Description=Code AI Assistant Daemon
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/code
Environment="PORT=3000"
ExecStart=/home/your-username/.bun/bin/bun --cwd packages/code-server start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable code-daemon
sudo systemctl start code-daemon
sudo systemctl status code-daemon
```

### launchd (macOS)

Create `~/Library/LaunchAgents/com.sylphx.code-daemon.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sylphx.code-daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/your-username/.bun/bin/bun</string>
        <string>--cwd</string>
        <string>packages/code-server</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/code</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>3000</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Enable and start:
```bash
launchctl load ~/Library/LaunchAgents/com.sylphx.code-daemon.plist
launchctl start com.sylphx.code-daemon
```

### Docker (Coming Soon)

```bash
# Not yet available
docker pull sylphx/code
docker run -p 3000:3000 -v ~/.code:/root/.code sylphx/code
```

## Verifying Installation

### Check Package Versions

```bash
# From repository root
bun run --filter "@sylphx/code-core" version
bun run --filter "@sylphx/code-server" version
```

### Run Tests

```bash
# Run all tests
bun test

# Run specific package tests
bun test --filter "@sylphx/code-client"
```

### Check Build Output

```bash
ls -la packages/code-core/dist
ls -la packages/code-server/dist
ls -la packages/code/dist
```

## Updating

### From Source

```bash
cd code
git pull origin main
bun install
bun run build
```

### Clean Reinstall

If you encounter issues:

```bash
# Clean all build artifacts
bun clean

# Remove node_modules
rm -rf node_modules packages/*/node_modules

# Reinstall
bun install
bun run build
```

## Troubleshooting

### Bun Installation Issues

**Permission denied:**
```bash
# Try with sudo (not recommended)
curl -fsSL https://bun.sh/install | sudo bash

# Or install to user directory
curl -fsSL https://bun.sh/install | bash
```

### Build Failures

**TypeScript errors:**
```bash
# Type check all packages
bun type-check
```

**Missing dependencies:**
```bash
# Reinstall dependencies
bun install --force
```

### Runtime Issues

**Port already in use:**
```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>

# Use different port
PORT=3001 bun dev:code
```

**Database errors:**
```bash
# Reset database
rm -rf packages/code-core/data/*.db
```

### Performance Issues

**Slow startup:**
- Check available RAM
- Close other applications
- Ensure SSD storage is used

**High CPU usage:**
- Check for active AI streaming
- Monitor background processes
- Reduce concurrent sessions

## Next Steps

- [Usage Guide](/guide/usage) - Learn how to use Code
- [Configuration](/guide/configuration) - Configure AI providers
- [Architecture](/architecture/) - Understand the system design

## Getting Help

- 📖 [Documentation](/)
- 🐛 [Report Installation Issues](https://github.com/SylphxAI/code/issues)
- 💬 [Community Discussions](https://github.com/SylphxAI/code/discussions)
