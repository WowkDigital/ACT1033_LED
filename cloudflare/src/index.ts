// Entry point of the ACT1033_LED Cloudflare Worker.
// Planned: render frames for the 64x16 panel and serve them to the ESP32 bridge.

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "act1033-led" });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
