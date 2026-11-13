# web/ – control page (GitHub Pages)

A static page for composing content and sending it to **your own** Cloudflare Worker ([../cloudflare](../cloudflare)).
You enter the Worker URL, the panel ID and a write token; everything is rendered in the browser (text with Polish letters,
scrolling/blinking, Game of Life, or any GIF/PNG file), shown in a live preview, and uploaded as a finished GIF.
The ESP32 then downloads it at its next check. The **Departures** tab instead sets up an autonomous job that runs on the Worker
(next public-transit departures for a stop, refreshed every minute) with no browser open.

- No third-party scripts and no tracking. The only third-party request is the map tiles (OpenStreetMap) in the **Departures** tab, and only once you pick a stop; the Leaflet library itself is bundled. The token is sent only to the Worker URL you typed. "Remember on this device"
  stores it in this browser's `localStorage`; leave it unticked on shared computers.
- You can pre-fill the non-secret fields with a link: `https://<you>.github.io/ACT1033_LED/#worker=https://<your-worker>&panel=kitchen`.
- The renderer is the **same code as the Worker's** (`../cloudflare/src`), bundled by esbuild, so previews match what the Worker would produce.
  Game of Life is verified frame-for-frame against the Python implementation (`npm test`).

## Bluetooth upload and installing as an app (PWA)

**Send via Bluetooth** (Send section) uploads the previewed GIF straight from the browser to the panel with Web Bluetooth - no Worker, token or ESP32 needed
(`src/ble.js`, a port of `python/act1033led/protocol.py`; frames are tested byte-for-byte against the Python code in `test/ble.test.js`).

- Works in **Chrome / Edge on Android and desktop** over HTTPS (or `localhost`). Safari and every iPhone browser except Bluefy have no Web Bluetooth.
- The first send opens Chrome's device chooser (only `LED_BLE*` panels are listed). Chrome remembers the permission, so later visits connect without the chooser.
- The panel allows **one Bluetooth link at a time**: stop the ESP32 bridge (or close any phone app) before sending, otherwise the connection fails.
- The animation is stored in the panel and keeps playing after the link is closed. GIFs only (PNG files are not supported over Bluetooth).
- **The link stays open between sends** (one handshake, no new search) and is closed after 2 minutes without sending, or with the *Disconnect* button.
  A link also ends when Android suspends the page (screen off, other app in front); the next send reconnects by itself. The screen is kept on while a transfer runs (Wake Lock).

The **Departures** tab has its own **Send via Bluetooth** button for demos: the page reads the timetable, builds the same countdown GIF as the Worker 
(stop screen, departure animation) and uploads it. The countdown is timed for the moment the picture appears on the panel (link open + *Bluetooth delay* in Advanced, default 6 s; 
tune it if the panel runs a few seconds early or late). The GIF covers about 8 minutes, then the panel stays on its last picture until you send again; for a board that stays fresh without a phone use *Start departures* (Worker + ESP32).

The page is a **PWA**: in Chrome use the menu -> *Install app* / *Add to Home screen*. It then opens full screen and the page itself works offline
(composing and Bluetooth upload; the Worker and the Departures tab still need the internet). `sw.js` caches only same-origin files and never the Worker API
or the token. Every build gets a new cache name, so updates arrive on the next visit.

## Sections

The page has four sections: **Send** (live preview + Text / Game of Life / Blobs / file), **Departures**, **Debug** and **Settings**
(the Worker URL, panel ID and token - needed once; the page opens it by itself when nothing is saved). The header chip shows whether the ESP32
is checking in. **Debug** shows the ESP's last check-in and poll interval, the stored image, the Worker's last 200 events (uploads,
image downloads by the ESP, rejected tokens), the requests this page sent, and a "Copy report" button (no tokens in it). The data comes
from `GET /panel/:id/debug`, so the Worker needs migration `0005_debug.sql` (`npm run migrate` in `cloudflare/`).

The **Departures** tab picks a stop from the transit API: search by name (every matching stop is a button; a single match opens by itself), choose
a pole (the map shows where each pole is; click a marker to switch), then tick lines and choose a direction from what actually runs there. A preview
shows the next timetable departures for the chosen filters, and the Worker warns when they match nothing (that is what used to show as `NO DATA`).
**Extras** (countdown mode): the stop screen (name + clock + lines, every *n* s for *m* s, optional custom name, clock with or without seconds) and the
departure animation. "What the panel will show" plays the board live, in step with the clock, built by the Worker's own code (`cloudflare/src/board.ts`),
with the GIF size and anything that would be left out to fit the size budget.

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
