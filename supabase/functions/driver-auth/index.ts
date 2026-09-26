// Day Drive – driver app login (username + PIN) and PIN management
//   { action: "login", username, pin }                        → { success, email, token_hash }
//        the app then calls supabase.auth.verifyOtp({ token_hash, type: "magiclink" }) to get a normal session
//   { action: "set_pin", driverId, pin, username?, enabled? } → owner/admin only (admin panel)
//   { action: "disable", driverId }                           → owner/admin only
// verify_jwt is off: "login" is public, the admin actions check the caller's admin role themselves.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MESSAGES: Record<string, string> = {
  unknown: "Username or PIN is wrong.",
  wrong: "Username or PIN is wrong.",
  no_pin: "No PIN has been set for you yet. Please ask the office.",
  disabled: "Your driver app access is switched off. Please ask the office.",
  locked: "Too many wrong PINs. Please wait 15 minutes or ask the office.",
};

async function ensureAuthUser(driverId: string) {
  const { data: d, error } = await db.from("drivers").select("id, auth_user_id, first_name, last_name").eq("id", driverId).single();
  if (error) throw error;
  if (d.auth_user_id) {
    const { data: u } = await db.auth.admin.getUserById(d.auth_user_id);
    if (u?.user) return u.user;
  }
  const email = `driver-${d.id}@drivers.day-drive.local`;
  const password = crypto.randomUUID() + crypto.randomUUID();   // never used – drivers log in with the PIN
  const { data: created, error: ce } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { kind: "driver", driver_id: d.id } });
  if (ce) throw ce;
  await db.from("drivers").update({ auth_user_id: created.user.id }).eq("id", d.id);
  return created.user;
}

async function requireAdmin(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return null;
  const { data: a } = await db.from("admin_users").select("role, is_active").eq("id", u.user.id).maybeSingle();
  return a?.is_active && ["owner", "admin"].includes(a.role) ? u.user : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    const b = await req.json().catch(() => ({}));

    if (b.action === "login") {
      const username = String(b.username || "").trim().toLowerCase().slice(0, 40);
      const pin = String(b.pin || "").trim().slice(0, 6);
      if (!username || !/^\d{4,6}$/.test(pin)) return json({ success: false, error: MESSAGES.wrong }, 400);
      const { data, error } = await db.rpc("driver_check_pin", { p_username: username, p_pin: pin });
      if (error) throw error;
      const r = (data || [])[0] || { result: "unknown" };
      if (r.result !== "ok") { await sleep(400); return json({ success: false, error: MESSAGES[r.result] || MESSAGES.wrong }, 401); }
      const user = await ensureAuthUser(r.driver_id);
      const { data: link, error: le } = await db.auth.admin.generateLink({ type: "magiclink", email: user.email! });
      if (le) throw le;
      return json({ success: true, email: user.email, token_hash: link.properties.hashed_token });
    }

    // ---------- admin actions ----------
    const admin = await requireAdmin(req);
    if (!admin) return json({ success: false, error: "Only owner/admin can change driver logins." }, 403);
    const driverId = String(b.driverId || "");
    const { data: drv } = await db.from("drivers").select("id, first_name, last_name, username").eq("id", driverId).maybeSingle();
    if (!drv) return json({ success: false, error: "Driver not found." }, 404);

    if (b.action === "set_pin") {
      const pin = String(b.pin || "");
      if (!/^\d{4,6}$/.test(pin)) return json({ success: false, error: "The PIN must have 4 to 6 digits." }, 400);
      if (/^(\d)\1+$/.test(pin) || ["1234", "12345", "123456", "0000", "4321"].includes(pin)) return json({ success: false, error: "This PIN is too easy. Choose another one." }, 400);
      let username = drv.username;
      if (b.username !== undefined) {
        username = String(b.username || "").trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,40}$/.test(username)) return json({ success: false, error: "Username: 3–40 letters, numbers, . _ -" }, 400);
        const { data: taken } = await db.from("drivers").select("id").eq("username", username).neq("id", drv.id).maybeSingle();
        const { data: takenAdmin } = await db.from("admin_users").select("id").eq("username", username).maybeSingle();
        if (taken || takenAdmin) return json({ success: false, error: "This username is already taken." }, 409);
      }
      if (!username) return json({ success: false, error: "Enter a username for the driver." }, 400);
      const { error: ue } = await db.from("drivers").update({ username, app_enabled: b.enabled !== false }).eq("id", drv.id);
      if (ue) throw ue;
      const { error: pe } = await db.rpc("driver_set_pin", { p_driver_id: drv.id, p_pin: pin });
      if (pe) throw pe;
      await ensureAuthUser(drv.id);
      return json({ success: true, username });
    }
    if (b.action === "disable") {
      await db.from("drivers").update({ app_enabled: false }).eq("id", drv.id);
      return json({ success: true });
    }
    return json({ success: false, error: "Unknown action." }, 400);
  } catch (e) {
    console.error("driver-auth", e);
    return json({ success: false, error: "Login is not possible right now. Please try again." }, 500);
  }
});
