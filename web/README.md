# web/ – control page (GitHub Pages)

A static page for composing content and sending it to **your own** Cloudflare Worker ([../cloudflare](../cloudflare)).
You enter the Worker URL, the panel ID and a write token; everything is rendered in the browser (text with Polish letters,
scrolling/blinking, Game of Life, or any GIF/PNG file), shown in a live preview, and uploaded as a finished GIF.
The ESP32 then downloads it at its next check. The **Departures** tab instead sets up an autonomous job that runs on the Worker
(next public-transit departures for a stop, refreshed every minute) with no browser open.

- No third-party scripts and no tracking. The token is sent only to the Worker URL you typed. "Remember on this device"
  stores it in this browser's `localStorage`; leave it unticked on shared computers.
- You can pre-fill the non-secret fields with a link: `https://<you>.github.io/ACT1033_LED/#worker=https://<your-worker>&panel=kitchen`.
- The renderer is the **same code as the Worker's** (`../cloudflare/src`), bundled by esbuild, so previews match what the Worker would produce.
  Game of Life is verified frame-for-frame against the Python implementation (`npm test`).

## Develop

```bash
cd web
npm install
npm test
npm run build       # -> dist/
npm run dev         # build + serve dist/ on http://localhost:8080
```

## Publish with GitHub Pages

In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow
`.github/workflows/pages.yml` tests, builds and deploys `web/dist` on every push to `main` that touches `web/` or `cloudflare/src/`.
