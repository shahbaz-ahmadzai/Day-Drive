// Day Drive – manage admin logins (owner only)
//   { action: "create", username, password, firstName, lastName, email?, phone?, role }
//   { action: "set_active", userId, isActive }
//   { action: "reset_password", userId, password }
//   { action: "set_role", userId, role }
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
const ROLES = ["owner", "admin", "dispatcher", "accountant"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(jwt);
    if (!u?.user) return json({ success: false, error: "Not signed in." }, 401);
    const { data: me } = await db.from("admin_users").select("role, is_active").eq("id", u.user.id).maybeSingle();
    if (!me?.is_active || me.role !== "owner") return json({ success: false, error: "Only the owner can manage logins." }, 403);

    const b = await req.json().catch(() => ({}));
    const pw = (p: unknown) => {
      const s = String(p || "");
      if (s.length < 8) throw new Error("The password must have at least 8 characters.");
      return s;
    };

    if (b.action === "create") {
      const username = String(b.username || "").trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) return json({ success: false, error: "Username: 3–40 letters, numbers, . _ -" }, 400);
      const role = ROLES.includes(b.role) ? b.role : "admin";
      const email = String(b.email || "").trim().toLowerCase() || `${username}@admin.day-drive.local`;
      const { data: exists } = await db.from("admin_users").select("id").eq("username", username).maybeSingle();
      if (exists) return json({ success: false, error: "This username is already taken." }, 409);
      const { data: created, error } = await db.auth.admin.createUser({ email, password: pw(b.password), email_confirm: true, user_metadata: { username } });
      if (error) return json({ success: false, error: error.message }, 400);
      const { error: ie } = await db.from("admin_users").insert({
        id: created.user.id, username, first_name: b.firstName || null, last_name: b.lastName || null,
        email, phone: b.phone || null, role, must_change_password: true,
      });
      if (ie) { await db.auth.admin.deleteUser(created.user.id); throw ie; }
      return json({ success: true, userId: created.user.id });
    }

    const userId = String(b.userId || "");
    if (!userId) return json({ success: false, error: "User is missing." }, 400);
    if (userId === u.user.id && (b.action === "set_active" || b.action === "set_role")) {
      return json({ success: false, error: "You can't change your own role or deactivate yourself." }, 400);
    }
    if (b.action === "set_active") {
      await db.from("admin_users").update({ is_active: !!b.isActive }).eq("id", userId);
      await db.auth.admin.updateUserById(userId, { ban_duration: b.isActive ? "none" : "876000h" });
      return json({ success: true });
    }
    if (b.action === "set_role") {
      if (!ROLES.includes(b.role)) return json({ success: false, error: "Unknown role." }, 400);
      await db.from("admin_users").update({ role: b.role }).eq("id", userId);
      return json({ success: true });
    }
    if (b.action === "reset_password") {
      const { error } = await db.auth.admin.updateUserById(userId, { password: pw(b.password) });
      if (error) return json({ success: false, error: error.message }, 400);
      await db.from("admin_users").update({ must_change_password: true }).eq("id", userId);
      return json({ success: true });
    }
    return json({ success: false, error: "Unknown action." }, 400);
  } catch (e) {
    console.error("admin-users", e);
    return json({ success: false, error: e instanceof Error ? e.message : "Error" }, 400);
  }
});
