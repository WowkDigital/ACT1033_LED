// Test helper: sets the first admin password on a fresh test environment and returns an admin session token.
import worker from "../src/index.ts";

export const SETUP_TOKEN = "setup-secret";
export const PASSWORD = "correct horse battery";

export async function adminSession(env: { DB: D1Database; SETUP_TOKEN?: string }): Promise<string> {
  const r = await worker.fetch(
    new Request("https://x/admin/setup", { method: "POST", body: JSON.stringify({ password: PASSWORD, setup_token: SETUP_TOKEN }) }),
    env,
  );
  if (r.status !== 201) throw new Error("setup failed: " + r.status + " " + (await r.text()));
  return ((await r.json()) as { session: string }).session;
}
