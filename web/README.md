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

## Sections

The page has four sections: **Send** (live preview + Text / Game of Life / Blobs / file), **Departures**, **Debug** and **Settings**
(the Worker URL, panel ID and token - needed once; the page opens it by itself when nothing is saved). The header chip shows whether the ESP32
is checking in. **Debug** shows the ESP's last check-in and poll interval, the stored image, the Worker's last 200 events (uploads,
image downloads by the ESP, rejected tokens), the requests this page sent, and a "Copy report" button (no tokens in it). The data comes
from `GET /panel/:id/debug`, so the Worker needs migration `0005_debug.sql` (`npm run migrate` in `cloudflare/`).

## Admin page

`admin/` (on GitHub Pages: `https://<you>.github.io/ACT1033_LED/admin/`) manages panels entirely in the browser: sign in with the admin
password, then list panels, create one (own ID or generated), rotate the write/read token, delete a panel, rotate or delete everything,
change the password or sign out everywhere. The password is checked by the Worker (PBKDF2 hash in D1) and exchanged for an 8-hour session
token kept in `sessionStorage` only. New tokens are displayed once – the Worker keeps only their hashes.
First run: the page asks for the Worker's one-time `SETUP_TOKEN` secret and lets you choose the password.

## CORS

The Worker only answers browsers from the origins in its `ALLOWED_ORIGIN` variable. If the page says it cannot reach the Worker, check that
your page's origin (e.g. `https://<you>.github.io`, or `http://localhost:8080` while developing) is in that list:
`npm run setup -- --origin "https://<you>.github.io,http://localhost:8080"` in `cloudflare/`.

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
