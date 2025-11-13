# Code Documentation

VitePress-powered documentation site for [Code - AI Code Assistant](https://github.com/SylphxAI/code).

## 🌐 Live Site

**Production:** https://code.sylphx.com

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18 or Bun >= 1.3.1

### Local Development

```bash
# Install dependencies
npm install
# or
bun install

# Start dev server
npm run dev
# or
bun dev

# Open http://localhost:5173
```

### Build for Production

```bash
# Build static site
npm run build
# or
bun build

# Preview production build
npm run preview
# or
bun preview
```

## 📁 Structure

```
docs/
├── .vitepress/
│   └── config.mts          # VitePress configuration
├── public/
│   └── logo.svg            # Static assets
├── index.md                # Landing page
├── guide/
│   ├── index.md           # Getting Started
│   ├── installation.md    # Installation Guide
│   ├── usage.md           # Usage Guide
│   └── configuration.md   # Configuration
├── architecture/
│   ├── index.md           # Architecture Overview
│   ├── trpc.md            # tRPC Communication
│   └── streaming.md       # Event Streaming
├── api/
│   └── index.md           # API Reference
└── development/
    └── index.md           # Development Guide
```

## 🎨 Customization

### Theme Configuration

Edit `.vitepress/config.mts` to customize:

- Site title and description
- Navigation menu
- Sidebar structure
- Social links
- Theme colors

### Adding Pages

1. Create new `.md` file in appropriate directory
2. Add frontmatter (optional):
   ```yaml
   ---
   title: Page Title
   description: Page description
   ---
   ```
3. Update sidebar in `.vitepress/config.mts`

### Styling

VitePress supports custom CSS in `.vitepress/theme/`:

```
.vitepress/
└── theme/
    ├── index.ts          # Theme entry
    └── custom.css        # Custom styles
```

## 🚢 Deployment

### Vercel (Recommended)

The site is configured for automatic deployment on Vercel:

1. **Connect Repository:**
   - Import repository in Vercel dashboard
   - Vercel auto-detects configuration from `vercel.json`

2. **Configure Domain:**
   - Add custom domain: `code.sylphx.com`
   - Vercel automatically configures DNS

3. **Automatic Deployments:**
   - Push to `main` → Production deployment
   - Pull requests → Preview deployments

**Configuration:** See `vercel.json` in repository root

### Manual Build

```bash
# Build
npm run build

# Output directory
docs/.vitepress/dist/

# Deploy to any static host:
# - Netlify
# - GitHub Pages
# - Cloudflare Pages
# - AWS S3 + CloudFront
```

### GitHub Pages

```yaml
# .github/workflows/deploy.yml
name: Deploy Docs

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: cd docs && npm install && npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs/.vitepress/dist
```

## 📝 Content Guidelines

### Writing Style

- Use clear, concise language
- Include code examples
- Add diagrams for complex concepts
- Link to related pages
- Keep content up-to-date

### Markdown Features

VitePress supports:

- **Syntax highlighting:** \`\`\`typescript
- **Custom containers:** ::: tip, ::: warning, ::: danger
- **Code groups:** Tabbed code blocks
- **Frontmatter:** YAML metadata
- **Vue components:** Embed Vue in markdown

### Code Examples

```typescript
// Always include language identifier
const client = createClient({
  transport: 'in-process'
})

// Add comments for clarity
const session = await client.session.create.mutate({
  provider: 'openrouter',  // AI provider
  model: 'claude-3.5-sonnet'  // Model name
})
```

### Links

```markdown
<!-- Relative links (preferred) -->
[Installation Guide](/guide/installation)
[Architecture](/architecture/)

<!-- External links -->
[GitHub](https://github.com/SylphxAI/code)
```

## 🔍 Search

VitePress includes built-in local search. No configuration needed.

**Features:**
- Automatic indexing
- Fast client-side search
- Keyboard shortcuts (Cmd/Ctrl + K)

## 🛠️ Troubleshooting

### Port Already in Use

```bash
# Use different port
npm run dev -- --port 5174
```

### Build Errors

```bash
# Clear cache
rm -rf .vitepress/cache .vitepress/dist

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

### Styling Issues

```bash
# Check browser console for errors
# Verify custom CSS syntax
# Clear browser cache
```

## 📚 Resources

- [VitePress Documentation](https://vitepress.dev)
- [Markdown Guide](https://www.markdownguide.org)
- [Vue.js Documentation](https://vuejs.org)

## 🤝 Contributing

To contribute to documentation:

1. Fork the repository
2. Create a feature branch
3. Make your changes in `docs/`
4. Test locally with `npm run dev`
5. Submit a pull request

See [Development Guide](/development/) for more details.

## 📄 License

MIT © [Sylphx](https://sylphx.com)

---

**Questions?** Open an issue on [GitHub](https://github.com/SylphxAI/code/issues)
