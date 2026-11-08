# cloudflare/

All Cloudflare code for ACT1033_LED lives here (Workers, config, tooling).

The Worker is a universal renderer: it takes a scene (text, shapes, animations) and returns a finished
PNG/GIF for the 64x16 panel. See [docs/RENDER_API.md](../docs/RENDER_API.md).

```
npm install
npx wrangler login      # once
npm run dev             # local
npm run deploy
```

Secrets go in `.dev.vars` (local, git-ignored) or `wrangler secret put` - never in the repo.
