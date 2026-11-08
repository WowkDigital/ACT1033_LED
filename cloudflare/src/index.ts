// ACT1033_LED universal render Worker: takes a scene description, returns a PNG or GIF for the 64x16 panel.
// POST /render (JSON spec) | GET /render?text=... | GET /health | GET / (usage)

import { render } from "./render.ts";
import { RenderError, type Element, type Spec } from "./types.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Frames, X-Width, X-Height, X-Size",
};

const json = (data: unknown, status = 200): Response =>
  Response.json(data, { status, headers: CORS });

const USAGE = {
  service: "act1033-led",
  description: "Renders text / shapes / animations into PNG or GIF for the 64x16 BK-Light panel (default size).",
  endpoints: {
    "GET /render": "text, color, bg, format (png|gif), scale, anim (none|scroll|blink), speed (1-5), align, valign, w, h, nonce",
    "POST /render": "JSON scene: { width, height, format, background, elements | frames, loop, frame, nonce } - see docs/RENDER_API.md",
    "GET /health": "liveness probe",
  },
  example: "/render?text=Hello%20Wroc%C5%82aw&color=00ff00&format=gif&anim=scroll",
};

function specFromQuery(q: URLSearchParams): Spec {
  const text = q.get("text");
  if (text === null) throw new RenderError('missing "text" (or POST a JSON scene)');
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const el: Element = {
    type: "text",
    text,
    color: q.get("color") ?? undefined,
    scale: num("scale"),
    align: (q.get("align") as "left" | "center" | "right" | null) ?? undefined,
    valign: (q.get("valign") as "top" | "middle" | "bottom" | null) ?? undefined,
    anim: (q.get("anim") as "none" | "scroll" | "blink" | null) ?? undefined,
    speed: num("speed"),
  };
  return {
    width: num("w"),
    height: num("h"),
    format: (q.get("format") as "png" | "gif" | null) ?? undefined,
    background: q.get("bg") ?? undefined,
    nonce: q.get("nonce") === "1",
    elements: [el],
  };
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    try {
      if (url.pathname === "/health") return json({ ok: true, service: "act1033-led" });
      if (url.pathname === "/") return json(USAGE);

      if (url.pathname === "/render") {
        let spec: Spec;
        if (request.method === "GET") spec = specFromQuery(url.searchParams);
        else if (request.method === "POST") {
          try {
            spec = (await request.json()) as Spec;
          } catch {
            throw new RenderError("body must be valid JSON");
          }
        } else return json({ error: "use GET or POST" }, 405);

        const out = render(spec);
        return new Response(out.body, {
          headers: {
            ...CORS,
            "Content-Type": out.contentType,
            "Cache-Control": spec.nonce ? "no-store" : request.method === "GET" ? "public, max-age=300" : "no-store",
            "X-Frames": String(out.frames),
            "X-Width": String(out.width),
            "X-Height": String(out.height),
            "X-Size": String(out.body.length),
          },
        });
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      if (e instanceof RenderError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler;
