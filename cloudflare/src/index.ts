// ACT1033_LED Worker: renders PNG/GIF for the 64x16 panel and relays finished images between a control page and the ESP32.
//
//   public:  GET /health | GET /
//   token:   POST|GET /render                       (any valid token)
//            PUT /panel/:id                         (panel write token)   upload a GIF/PNG
//            GET /panel/:id/image                   (panel read token)    download it (ETag / 304)
//            GET /panel/:id                         (any panel token)     metadata
//   admin:   POST|GET /admin/panels                 (ADMIN_TOKEN)         create / list
//            DELETE /admin/panels/:id | POST /admin/panels/:id/rotate

import { bearer } from "./auth.ts";
import {
  adminCreate,
  adminDelete,
  adminList,
  adminRotate,
  panelImage,
  panelMeta,
  panelPut,
  tokenIsValid,
  type Env,
} from "./panels.ts";
import { render } from "./render.ts";
import { RenderError, type Element, type Spec } from "./types.ts";

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match",
    "Access-Control-Expose-Headers": "ETag, X-Frames, X-Width, X-Height, X-Size",
    Vary: "Origin",
  };
}

const USAGE = {
  service: "act1033-led",
  description: "Renders text / shapes / animations into PNG or GIF for the 64x16 BK-Light panel and relays images to ESP32 clients.",
  auth: "Authorization: Bearer <token> (admin, panel write or panel read token)",
  endpoints: {
    "GET|POST /render": "scene -> PNG/GIF (any valid token); see docs/RENDER_API.md",
    "PUT /panel/:id": "upload GIF/PNG (write token)",
    "GET /panel/:id/image": "download the current image, supports If-None-Match (read token)",
    "GET /panel/:id": "metadata",
    "POST|GET /admin/panels": "create / list panels (ADMIN_TOKEN)",
    "DELETE /admin/panels/:id, POST /admin/panels/:id/rotate": "delete / rotate tokens (ADMIN_TOKEN)",
    "GET /health": "liveness probe",
  },
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

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  if (path === "/health") return Response.json({ ok: true, service: "act1033-led" });
  if (path === "/") return Response.json(USAGE);

  if (path === "/render") {
    if (!(await tokenIsValid(env, bearer(request)))) throw new RenderError("missing or invalid token", 401);
    let spec: Spec;
    if (method === "GET") spec = specFromQuery(url.searchParams);
    else if (method === "POST") {
      try {
        spec = (await request.json()) as Spec;
      } catch {
        throw new RenderError("body must be valid JSON");
      }
    } else throw new RenderError("use GET or POST", 405);
    const out = render(spec);
    return new Response(out.body, {
      headers: {
        "Content-Type": out.contentType,
        "Cache-Control": "no-store",
        "X-Frames": String(out.frames),
        "X-Width": String(out.width),
        "X-Height": String(out.height),
        "X-Size": String(out.body.length),
      },
    });
  }

  if (path === "/admin/panels") {
    if (method === "POST") return adminCreate(request, env);
    if (method === "GET") return adminList(request, env);
    throw new RenderError("use GET or POST", 405);
  }
  let m = /^\/admin\/panels\/([^/]+)(\/rotate)?$/.exec(path);
  if (m) {
    if (m[2]) {
      if (method !== "POST") throw new RenderError("use POST", 405);
      return adminRotate(request, env, m[1]!);
    }
    if (method !== "DELETE") throw new RenderError("use DELETE", 405);
    return adminDelete(request, env, m[1]!);
  }

  m = /^\/panel\/([^/]+)(\/image)?$/.exec(path);
  if (m) {
    const id = m[1]!;
    if (m[2]) {
      if (method !== "GET") throw new RenderError("use GET", 405);
      return panelImage(request, env, id);
    }
    if (method === "PUT") return panelPut(request, env, id);
    if (method === "GET") return panelMeta(request, env, id);
    throw new RenderError("use GET or PUT", 405);
  }

  throw new RenderError("not found", 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      res = await handle(request, env);
    } catch (e) {
      if (e instanceof RenderError) res = Response.json({ error: e.message }, { status: e.status });
      else {
        console.error(e);
        res = Response.json({ error: "internal error" }, { status: 500 });
      }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;
