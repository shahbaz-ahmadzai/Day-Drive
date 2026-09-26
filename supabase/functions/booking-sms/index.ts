// Day Drive – booking SMS via Twilio
// Called by the admin panel (logged-in admin) or by other functions with the service key.
//   { bookingId, template: "confirmation" }     → sends the booking confirmation to the customer
//   { bookingId, template: "admin_alert" }      → "new booking" SMS to the office number (Settings → Notifications)
//   { template: "test", phone }                 → test SMS from Settings → Integrations
//   { template: "custom", phone, text, kind }   → any text (service key only: login codes, contract updates …)
//   { template: "office", text }                → any text to the office mobile (service key only)
// Twilio Account SID + Auth Token are read from Supabase Vault (get_secret).
// verify_jwt is off because the function checks the caller itself (admin login or service key).
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

function normalizePhone(v: string, cc = "+49") {
  let p = String(v || "").trim().replace(/[\s()\-\/.]/g, "");
  if (!p) return "";
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (p.startsWith("+")) return p;
  if (p.startsWith("49") && p.length > 11) return "+" + p;
  if (p.startsWith("0")) return cc + p.slice(1);
  if (/^1[5-7]\d{8,10}$/.test(p)) return cc + p;
  return p;
}
function fmt(iso: string, lang: string) {
  const d = new Date(iso), loc = lang === "en" ? "en-GB" : "de-DE";
  return {
    date: new Intl.DateTimeFormat(loc, { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(d),
    time: new Intl.DateTimeFormat(loc, { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(d),
  };
}
function confirmationText(b: any, phone: string) {
  const t = fmt(b.booking_start, b.language);
  if (b.language === "en") {
    return `Hello ${b.customer_first_name}, your Day Drive booking ${b.booking_reference} is confirmed.\n` +
      `${t.date}, ${t.time}\nPickup: ${b.pickup_address}\n` +
      (b.vehicle_name ? `Vehicle: ${b.vehicle_name}\n` : "") +
      `Ride code: ${b.ride_code}\nQuestions? ${phone}\nDay Drive Service`;
  }
  return `Hallo ${b.customer_first_name}, Ihre Day Drive Buchung ${b.booking_reference} ist bestätigt.\n` +
    `${t.date}, ${t.time} Uhr\nAbholung: ${b.pickup_address}\n` +
    (b.vehicle_name ? `Fahrzeug: ${b.vehicle_name}\n` : "") +
    `Fahrtcode: ${b.ride_code}\nFragen? ${phone}\nDay Drive Service`;
}

async function sendTwilio(to: string, body: string, cfg: any) {
  const [{ data: sid }, { data: token }] = await Promise.all([
    db.rpc("get_secret", { p_name: "twilio_account_sid" }),
    db.rpc("get_secret", { p_name: "twilio_auth_token" }),
  ]);
  if (!sid || !token) throw new Error("Twilio is not configured (secrets missing in Vault).");
  const auth = "Basic " + btoa(`${sid}:${token}`);
  const senders = [cfg?.sender_name, cfg?.from_number].filter(Boolean);   // alphanumeric first, number as fallback
  let last: any = null;
  for (const from of senders) {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    const res = await r.json();
    if (r.ok) return { sid: res.sid, status: res.status, from };
    last = res;
    console.warn("Twilio refused sender", from, res?.code, res?.message);
  }
  throw new Error("Twilio: " + (last?.message || "SMS could not be sent"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    // who is calling? an active admin, or another function using the service key
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    let userId: string | null = null;
    if (!jwt) return json({ success: false, error: "Not signed in." }, 401);
    if (jwt !== SERVICE) {
      const { data: u } = await db.auth.getUser(jwt);
      if (!u?.user) return json({ success: false, error: "Not signed in." }, 401);
      const { data: a } = await db.from("admin_users").select("role, is_active").eq("id", u.user.id).maybeSingle();
      if (!a?.is_active || !["owner", "admin", "dispatcher"].includes(a.role)) return json({ success: false, error: "Not allowed." }, 403);
      userId = u.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const [{ data: integ }, { data: company }] = await Promise.all([
      db.from("integrations").select("enabled, public_config").eq("provider", "twilio").maybeSingle(),
      db.from("company_profile").select("phone").eq("id", 1).maybeSingle(),
    ]);
    if (!integ?.enabled) return json({ success: false, error: "Twilio SMS is switched off in Settings." }, 400);
    const cfg = integ.public_config || {};
    const companyPhone = company?.phone || "0176 43241205";

    let to: string, text: string, bookingId: string | null = null, template = String(body.template || "confirmation");
    if ((template === "custom" || template === "office") && userId) {
      return json({ success: false, error: "Not allowed." }, 403);
    }
    if (template === "custom") {
      to = normalizePhone(String(body.phone || ""), cfg.default_country_code);
      text = String(body.text || "").slice(0, 600);
      template = String(body.kind || "custom").slice(0, 40);
      bookingId = body.bookingId ? String(body.bookingId) : null;
      if (!text) return json({ success: false, error: "Text is missing." }, 400);
    } else if (template === "office") {
      const { data: st } = await db.from("app_settings").select("value").eq("key", "notifications.admin_alert_phone").maybeSingle();
      if (!st?.value) return json({ success: true, skipped: "no office number" });
      to = normalizePhone(String(st.value), cfg.default_country_code);
      text = String(body.text || "").slice(0, 600);
      template = "office_" + String(body.kind || "alert").slice(0, 30);
    } else if (template === "admin_alert") {
      const { data: st } = await db.from("app_settings").select("key, value").in("key", ["notifications.admin_alert_phone"]);
      const office = st?.find((r) => r.key === "notifications.admin_alert_phone")?.value;
      if (!office) return json({ success: true, skipped: "no office number" });
      bookingId = String(body.bookingId || "");
      const { data: b } = await db.from("bookings").select("*").eq("id", bookingId).maybeSingle();
      if (!b) return json({ success: false, error: "Booking not found." }, 404);
      const t = fmt(b.booking_start, "de");
      to = normalizePhone(String(office), cfg.default_country_code);
      text = `Neue Buchung ${b.booking_reference}\n${t.date}, ${t.time} Uhr\n${b.customer_first_name} ${b.customer_last_name}, ${b.customer_phone}\n` +
        `${b.pickup_address} → ${b.destination_address}\n${b.vehicle_name || ""} · ${Number(b.price_amount).toFixed(2)} €`;
    } else if (template === "test") {
      to = normalizePhone(body.phone, cfg.default_country_code);
      text = "Day Drive Service: test SMS – Twilio is connected. / Test-SMS – Twilio ist verbunden.";
    } else {
      bookingId = String(body.bookingId || "");
      const { data: b, error } = await db.from("bookings").select("*").eq("id", bookingId).maybeSingle();
      if (error || !b) return json({ success: false, error: "Booking not found." }, 404);
      to = normalizePhone(body.phone || b.customer_phone, cfg.default_country_code);
      text = confirmationText(b, companyPhone);
      template = "booking_confirmation";
    }
    if (!/^\+\d{8,15}$/.test(to)) return json({ success: false, error: "Phone number is not valid: " + to }, 400);

    const logText = template === "login_code" ? "Day Drive login code (hidden)" : text;
    try {
      const sent = await sendTwilio(to, text, cfg);
      await db.from("notifications").insert({ channel: "sms", provider: "twilio", template, recipient: to, body: logText, booking_id: bookingId, status: "sent", provider_message_id: sent.sid, created_by: userId });
      if (bookingId && template === "booking_confirmation") await db.from("booking_events").insert({ booking_id: bookingId, event_type: "sms_sent", message: "Confirmation SMS sent to " + to, data: { sid: sent.sid, from: sent.from }, created_by: userId });
      await db.from("integrations").update({ status: "connected", last_tested_at: new Date().toISOString(), last_error: null }).eq("provider", "twilio");
      return json({ success: true, to, from: sent.from, sid: sent.sid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from("notifications").insert({ channel: "sms", provider: "twilio", template, recipient: to, body: logText, booking_id: bookingId, status: "failed", error: msg, created_by: userId });
      await db.from("integrations").update({ status: "error", last_tested_at: new Date().toISOString(), last_error: msg }).eq("provider", "twilio");
      return json({ success: false, error: msg }, 502);
    }
  } catch (e) {
    console.error("booking-sms", e);
    return json({ success: false, error: "SMS could not be sent." }, 500);
  }
});
