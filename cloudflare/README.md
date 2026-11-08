# cloudflare/

All Cloudflare code for ACT1033_LED lives here (Workers, config, tooling).

Planned role: the Worker renders frames (text, fonts, GTFS, animations) into the
panel's native frame format; the ESP32 only fetches them and relays over BLE.

```
npm install
npx wrangler login      # once
npm run dev             # local
npm run deploy
```

Secrets go in `.dev.vars` (local, git-ignored) or `wrangler secret put` - never in the repo.
