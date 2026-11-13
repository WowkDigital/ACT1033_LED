// Direct Bluetooth LE upload to the panel from the browser (Web Bluetooth). Port of python/act1033led/protocol.py + device.py;
// the frames and timings are described in docs/PROTOCOL.md. No server is involved: the GIF goes from this page to the panel.

export const SERVICE = "0000fa00-0000-1000-8000-00805f9b34fb";
export const UUID_WRITE = "0000fa02-0000-1000-8000-00805f9b34fb";
export const UUID_NOTIFY = "0000fa03-0000-1000-8000-00805f9b34fb";
export const NAME_PREFIX = "LED_BLE";

const HANDSHAKE_1 = Uint8Array.of(0x08, 0x00, 0x01, 0x80, 0x0e, 0x06, 0x32, 0x00);
const HANDSHAKE_2 = Uint8Array.of(0x04, 0x00, 0x05, 0x80);
const TYPE_GIF = 0x03;
const MARKER = 0x65; // byte 14 of every frame; any other value breaks playback
const SEGMENT = 4096; // data bytes per segment
const CHUNK = 509; // bytes per BLE write (MTU 512)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- pure helpers (unit-tested in test/ble.test.js)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Four random bytes after the GIF trailer: the panel corrupts its animation when it receives an identical file twice. */
export function withUniqueTail(gif, tail = crypto.getRandomValues(new Uint8Array(4))) {
  const out = new Uint8Array(gif.length + tail.length);
  out.set(gif);
  out.set(tail, gif.length);
  return out;
}

/** One frame (or one segment): 15-byte header + data. `total` is the whole file; its length and CRC go into every segment. */
export function buildFrame(data, { type = TYPE_GIF, first = true, total = data } = {}) {
  const out = new Uint8Array(15 + data.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, data.length + 15, true);
  out[2] = type;
  out[3] = 0x00;
  out[4] = first ? 0x00 : 0x02;
  v.setUint32(5, total.length, true);
  v.setUint32(9, crc32(total), true);
  out[13] = 0x00;
  out[14] = MARKER;
  out.set(data, 15);
  return out;
}

export function gifSegments(gif, segment = SEGMENT) {
  const frames = [];
  for (let off = 0; off < gif.length; off += segment) frames.push(buildFrame(gif.subarray(off, off + segment), { first: off === 0, total: gif }));
  return frames;
}

/** stage1 / stage2 (handshake replies), "done" (complete), "ack" (segment received) or null. */
export function classify(data) {
  if (data.length >= 4 && data[2] === 0x01 && data[3] === 0x80) return "stage1";
  if (data.length >= 4 && data[2] === 0x05 && data[3] === 0x80) return "stage2";
  if (data.length === 5 && data[3] === 0x00) return data[4] === 0x03 ? "done" : "ack";
  return null;
}

// ---------------------------------------------------------------- Web Bluetooth session
// The link is kept open between sends and closed after IDLE_MS without traffic, so consecutive sends need no new
// search or handshake. The panel allows one link at a time, which is why it is not held forever (the ESP32 bridge could not connect).
export const supported = () => typeof navigator !== "undefined" && !!navigator.bluetooth;
export const IDLE_MS = 2 * 60 * 1000;

let device = null; // the chosen panel; remembered while the page lives (and by Chrome, see getDevices below)
let session = null; // { write, events, shaken } while connected
let idleTimer = null;
let onState = () => {};
let logFn = () => {};
export const setStateListener = (fn) => (onState = fn);
/** "idle" (no panel chosen / not connected) or "connected" */
export const isConnected = () => !!(session && device?.gatt?.connected);

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => disconnect("idle for " + IDLE_MS / 60000 + " min"), IDLE_MS);
}

export function disconnect(why = "") {
  clearTimeout(idleTimer);
  if (device?.gatt?.connected) device.gatt.disconnect();
  if (session) logFn("disconnected" + (why ? " (" + why + ")" : ""));
  session = null;
  onState();
}

/** Forget the chosen panel so the next send shows the chooser again. */
export function forgetDevice() {
  disconnect();
  device = null;
}

async function pickDevice() {
  // A panel the user allowed before (even in an earlier visit) is returned without any dialog.
  try {
    const known = (await navigator.bluetooth.getDevices?.()) || [];
    const mine = known.find((d) => d.name?.startsWith(NAME_PREFIX));
    if (mine) return mine;
  } catch {
    /* getDevices not available: fall through to the chooser */
  }
  // Must run directly from a click. The chooser lists only panels named LED_BLE*.
  return navigator.bluetooth.requestDevice({ filters: [{ namePrefix: NAME_PREFIX }], optionalServices: [SERVICE] });
}

async function connect() {
  if (!device) {
    device = await pickDevice();
    device.addEventListener("gattserverdisconnected", () => {
      clearTimeout(idleTimer);
      if (session) logFn("link lost");
      session = null;
      onState();
    });
  }
  logFn("connecting to " + (device.name || "panel") + "…");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE);
  const write = await service.getCharacteristic(UUID_WRITE);
  const notify = await service.getCharacteristic(UUID_NOTIFY);
  const events = { stage1: false, stage2: false, ack: false, done: false };
  notify.addEventListener("characteristicvaluechanged", (e) => {
    const data = new Uint8Array(e.target.value.buffer);
    const kind = classify(data);
    logFn("panel: " + Array.from(data, (b) => b.toString(16).padStart(2, "0")).join(" "));
    if (kind) {
      events[kind] = true;
      if (kind === "done") events.ack = true;
    }
  });
  await notify.startNotifications(); // the CCCD write is acknowledged; the panel stays silent otherwise
  session = { write, events, shaken: false, chunk: CHUNK };
  onState();
}

/** Sends a finished GIF over the open link (opening it first when needed). `log(text)`, `progress(done, total)` optional.
 *  Returns true when the panel confirmed it. */
export async function sendGif(gif, { log = () => {}, progress = () => {} } = {}) {
  if (!supported()) throw new Error("This browser has no Web Bluetooth. Use Chrome on Android or desktop.");
  if (gif.length < 4 || String.fromCharCode(gif[0], gif[1], gif[2], gif[3]) !== "GIF8") throw new Error("Bluetooth upload needs a GIF (not PNG)");
  logFn = log;
  clearTimeout(idleTimer); // no idle disconnect in the middle of a transfer
  try {
    if (!isConnected()) await connect();
    const { write, events } = session;
    const wait = async (name, ms) => {
      for (let t = 0; t < ms; t += 20) {
        if (events[name]) return true;
        await sleep(20);
      }
      return events[name];
    };
    const put = async (bytes) => {
      for (let i = 0; i < bytes.length; ) {
        try {
          await write.writeValueWithoutResponse(bytes.subarray(i, i + session.chunk));
          i += session.chunk;
          await sleep(10);
        } catch (e) {
          if (session.chunk <= 20) throw e;
          session.chunk = session.chunk > 182 ? 182 : 20; // the link negotiated a smaller MTU: retry with smaller writes
          log("write failed, retrying with " + session.chunk + "-byte chunks");
        }
      }
    };

    if (!session.shaken) {
      // The handshake is needed once per connection (docs/PROTOCOL.md).
      await put(HANDSHAKE_1);
      if (!(await wait("stage1", 5000))) log("handshake 1: no reply (continuing)");
      await sleep(200);
      await put(HANDSHAKE_2);
      if (!(await wait("stage2", 5000))) log("handshake 2: no reply (continuing)");
      await sleep(200);
      session.shaken = true;
    }

    const frames = gifSegments(withUniqueTail(gif));
    events.done = false;
    for (let k = 0; k < frames.length; k++) {
      events.ack = false;
      await put(frames[k]);
      progress(k + 1, frames.length);
      if (k < frames.length - 1) await wait("ack", 2000);
    }
    const ok = await wait("done", 6000);
    await sleep(500);
    return ok;
  } catch (e) {
    disconnect("error"); // a half-finished transfer leaves the link in an unknown state: start clean next time
    throw e;
  } finally {
    if (session) armIdle();
  }
}
