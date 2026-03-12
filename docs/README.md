# Encounty Documentation

This directory contains the Docusaurus documentation site for Encounty.

## Development

### Install Dependencies

```bash
yarn install
```

### Start Development Server

```bash
yarn start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server.

### Build

```bash
yarn build
```

This command generates static content into the `build` directory and can be served using any static contents hosting service.

### Deployment

The documentation is automatically deployed to GitHub Pages when changes are pushed to the main branch.

Manual deployment:

```bash
yarn deploy
```

## Documentation Structure

```
docs/
├── docs/                    # Documentation content (Markdown)
│   ├── intro.md            # Introduction page
│   ├── installation.md     # Installation guide
│   ├── getting-started.md  # Getting started guide
│   ├── architecture/       # Architecture documentation
│   │   ├── hybrid.md       # Hybrid Electron + Go architecture
│   │   └── components.md   # Component architecture
│   ├── development/        # Development guides
│   │   ├── setup.md        # Development setup
│   │   ├── structure.md    # Repository structure
│   │   └── contributing.md # Contributing guidelines
│   ├── api/                # API reference
│   │   ├── rest.md         # REST API
│   │   └── websocket.md    # WebSocket API
│   └── deployment.md       # Deployment guide
├── src/                    # React components for the site
├── static/                 # Static assets (images, etc.)
├── docusaurus.config.ts    # Docusaurus configuration
├── sidebars.ts             # Sidebar configuration
└── package.json            # Dependencies and scripts
```

## Adding Documentation

1. Create a new Markdown file in `docs/`
2. Add frontmatter at the top:
   ```markdown
   ---
   sidebar_position: 1
   ---

   # Page Title
   ```
3. Update `sidebars.ts` if needed
4. Preview changes with `yarn start`
5. Build to verify: `yarn build`

## Writing Guidelines

- Use clear, concise English
- Include code examples where relevant
- Add screenshots for UI features
- Link to related documentation
- Use proper Markdown formatting
- Test all code examples

## Syntax Highlighting

Supported languages:
- `bash` - Shell commands
- `go` - Go code
- `typescript` - TypeScript/JavaScript
- `json` - JSON data
- `yaml` - YAML configuration
- `makefile` - Makefile syntax

Example:

````markdown
```go
func main() {
    fmt.Println("Hello, World!")
}
```
````

## MDX Features

Docusaurus uses MDX, which allows you to use JSX in Markdown:

```mdx
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

<Tabs>
  <TabItem value="linux" label="Linux">
    Linux-specific content
  </TabItem>
  <TabItem value="windows" label="Windows">
    Windows-specific content
  </TabItem>
</Tabs>
```

## Troubleshooting

### Build Errors

If you encounter build errors:

1. Clear cache: `yarn docusaurus clear`
2. Delete `node_modules` and reinstall: `rm -rf node_modules && yarn install`
3. Check for MDX syntax errors in Markdown files
4. Verify all internal links are valid

### Port Already in Use

If port 3000 is already in use:

```bash
PORT=3001 yarn start
```

## Links

- [Docusaurus Documentation](https://docusaurus.io/)
- [MDX Documentation](https://mdxjs.com/)
- [Encounty GitHub Repository](https://github.com/ZSleyer/Encounty)
