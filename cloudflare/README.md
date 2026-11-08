# cloudflare/ – your own Worker

A Cloudflare Worker (TypeScript) with a D1 database. It does two things:

1. **Renders** text / shapes / animations into a finished PNG/GIF for the 64×16 panel (`/render`).
2. **Relays** images between the control page ([../web](../web)) and your ESP32 ([../esp32-client](../esp32-client)) – each panel has
   its own ID and tokens (`/panel/:id`).

API reference: [../docs/RENDER_API.md](../docs/RENDER_API.md). Everyone runs **their own** Worker, so nobody else's quota or data is involved.

## Set up your own (about 5 minutes)

You need a free Cloudflare account and Node.js ≥ 22.

```bash
cd cloudflare
npm install
npx wrangler login          # once
npm run setup
```

`npm run setup` creates (or finds) the D1 database `act1033-led`, applies the migrations, deploys the Worker, and generates an
`ADMIN_TOKEN` stored as a Worker secret (a copy is written to `cloudflare/.admin-token`, which is git-ignored – keep it private).
It also writes `wrangler.local.jsonc` with your D1 id (git-ignored). Later deploys: `npm run deploy`.

Create a panel (use your Worker URL and the admin token):

```bash
curl -X POST https://<your-worker>/admin/panels \
  -H "Authorization: Bearer <ADMIN_TOKEN>" -d '{"id":"kitchen","name":"Kitchen"}'
```

The answer contains `write_token` (for the control page) and `read_token` (for the ESP) – **shown only once**. Give each person
a panel of their own; lost tokens can be replaced with `POST /admin/panels/<id>/rotate`.

The Worker also has a **cron trigger (every minute)** for the departures job (`docs/RENDER_API.md`). `TRANSIT_URL` (var, default the public
Wrocław transit API) says where departures come from; the compatibility flag `global_fetch_strictly_public` lets the Worker call another
Worker of your own account through its public `workers.dev` address.

Optional vars: `POLL_BURST_S`, `POLL_IDLE_S`, `BURST_WINDOW_S` tune how fast the ESP checks after a change (see the API doc).
**Limit browser access to your control page** (recommended):

```bash
npm run setup -- --origin https://<you>.github.io
# several pages (e.g. for local development): --origin "https://<you>.github.io,http://localhost:8080"
```

The list is stored in `wrangler.local.jsonc` (`vars.ALLOWED_ORIGIN`) and remembered by later `npm run setup` runs; no value or `*` means any page.
Only a request from a listed origin gets CORS headers, so other websites cannot use the Worker from a browser. This is enforced by browsers only - the
**tokens are the real protection**, and the ESP32 and `curl` are not affected by CORS.

## Development

```bash
npm test                    # 27 tests, in-memory SQLite stands in for D1
npm run check               # tsc --noEmit
npm run dev                 # wrangler dev (uses wrangler.local.jsonc)
python tools/gen_font.py    # regenerate src/font.ts after editing python/act1033led/font.py
```

## Secrets – what must never be committed

`.admin-token`, `.panel-*.json`, `.dev.vars` and `wrangler.local.jsonc` are in `.gitignore`. Tokens only ever travel in the
`Authorization` header, never in URLs.

## Free-plan limits (check the current Cloudflare docs)

Workers: ~100k requests/day. D1: ~100k row writes and ~5M row reads per day. An ESP polling every 30 s uses ~2900 requests/day, and a
`304` costs no D1 write. The cron trigger adds 1440 invocations/day; the departures job writes to D1 only when it replaces the picture (the countdown GIF: about every 5 minutes, ≈ 290 writes/day). Uploads that do not change the picture are not written either.
