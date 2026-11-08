// Token helpers. Tokens are random 256-bit values, so a plain SHA-256 is enough for storage (no slow KDF needed).

export async function sha256hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** prefix + 32 random bytes, base64url - e.g. "w_3q2-..." */
export function randomToken(prefix: string): string {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return prefix + btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function bearer(request: Request): string | null {
  const h = request.headers.get("Authorization");
  const m = h && /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1]! : null;
}
