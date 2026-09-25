// Day Drive – admin login helper
// Turns a username into the e-mail Supabase Auth needs. Public (no JWT), returns nothing useful for unknown names.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    const { login } = await req.json().catch(() => ({}));
    const value = String(login || "").trim().toLowerCase();
    if (!value || value.length > 120) return json({ success: false, error: "Invalid login." }, 400);
    if (value.includes("@")) return json({ success: true, email: value });

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data, error } = await db.from("admin_users").select("id, is_active").eq("username", value).maybeSingle();
    if (error) throw error;
    // small delay so usernames can't be guessed quickly
    await new Promise((r) => setTimeout(r, 300));
    if (!data || !data.is_active) return json({ success: false, error: "Invalid login." }, 404);
    const { data: u, error: ue } = await db.auth.admin.getUserById(data.id);
    if (ue || !u?.user?.email) return json({ success: false, error: "Invalid login." }, 404);
    return json({ success: true, email: u.user.email });
  } catch (e) {
    console.error("admin-login", e);
    return json({ success: false, error: "Invalid login." }, 400);
  }
});
