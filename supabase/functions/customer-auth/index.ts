// Day Drive – customer login for "My Day Drive" (no password)
//   { action: "request", phone }          → sends a 6-digit code by SMS (answer is the same whether the number is known or not)
//   { action: "verify", phone, code }     → { success, email, token_hash }
//        the website then calls supabase.auth.verifyOtp({ token_hash, type: "magiclink" }) and is logged in
// E-mail codes follow once Resend is connected (channel "email").
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const URL_ = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const TEXT: Record<string, (c: string) => string> = {
  de: (c) => `Ihr Day Drive Code: ${c}\nGültig 10 Minuten. Nicht weitergeben.`,
  en: (c) => `Your Day Drive code: ${c}\nValid for 10 minutes. Do not share it.`,
  ar: (c) => `رمز Day Drive الخاص بك: ${c}\nصالح لمدة 10 دقائق. لا تشاركه.`,
  ps: (c) => `ستاسو د Day Drive کوډ: ${c}\n۱۰ دقیقې اعتبار لري. له بل چا سره یې مه شریکوئ.`,
  fa: (c) => `کد Day Drive شما: ${c}\nتا ۱۰ دقیقه معتبر است. آن را با کسی در میان نگذارید.`,
};

async function sendSms(phone: string, text: string) {
  const r = await fetch(URL_ + "/functions/v1/booking-sms", {
    method: "POST",
    headers: { Authorization: "Bearer " + SERVICE, apikey: SERVICE, "Content-Type": "application/json" },
    body: JSON.stringify({ template: "custom", phone, text, kind: "login_code" }),
  });
  if (!r.ok) console.warn("login code sms failed", r.status, await r.text());
  return r.ok;
}

async function ensureAuthUser(customerId: string) {
  const { data: c, error } = await db.from("customers").select("id, auth_user_id, first_name").eq("id", customerId).single();
  if (error) throw error;
  if (c.auth_user_id) {
    const { data: u } = await db.auth.admin.getUserById(c.auth_user_id);
    if (u?.user) return u.user;
  }
  const email = `customer-${c.id}@customers.day-drive.local`;
  const { data: created, error: ce } = await db.auth.admin.createUser({
    email, password: crypto.randomUUID() + crypto.randomUUID(), email_confirm: true, user_metadata: { kind: "customer", customer_id: c.id },
  });
  if (ce) throw ce;
  await db.from("customers").update({ auth_user_id: created.user.id }).eq("id", c.id);
  return created.user;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const phone = String(b.phone || "").trim().slice(0, 40);
    if (phone.replace(/\D/g, "").length < 7) return json({ success: false, error: "Please enter your mobile number." }, 400);

    if (b.action === "request") {
      const { data, error } = await db.rpc("customer_code_create", { p_destination: phone, p_channel: "sms" });
      if (error) throw error;
      if (data?.throttled) return json({ success: false, error: "Too many codes requested. Please wait 15 minutes." }, 429);
      if (data?.found) {
        const lang = TEXT[data.language] ? data.language : (TEXT[b.language] ? b.language : "de");
        await sendSms(data.destination, TEXT[lang](data.code));
      } else {
        await new Promise((r) => setTimeout(r, 600));
      }
      // same answer for known and unknown numbers
      return json({ success: true, message: "If this number belongs to a Day Drive booking, a code was sent by SMS." });
    }

    if (b.action === "verify") {
      const code = String(b.code || "").replace(/\D/g, "");
      if (code.length !== 6) return json({ success: false, error: "Enter the 6-digit code." }, 400);
      const { data, error } = await db.rpc("customer_code_verify", { p_destination: phone, p_code: code, p_channel: "sms" });
      if (error) throw error;
      if (!data?.ok) {
        const msg = data?.error === "too_many" ? "Too many wrong codes. Request a new code." :
                    data?.error === "expired" ? "The code has expired. Request a new code." : "The code is wrong.";
        return json({ success: false, error: msg }, 401);
      }
      const user = await ensureAuthUser(data.customer_id);
      const { data: link, error: le } = await db.auth.admin.generateLink({ type: "magiclink", email: user.email! });
      if (le) throw le;
      return json({ success: true, email: user.email, token_hash: link.properties.hashed_token });
    }
    return json({ success: false, error: "Unknown action." }, 400);
  } catch (e) {
    console.error("customer-auth", e);
    return json({ success: false, error: "Login is not possible right now. Please try again or call us." }, 500);
  }
});
