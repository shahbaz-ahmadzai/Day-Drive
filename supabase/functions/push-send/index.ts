// Day Drive – push notifications (called by database triggers via pg_net, header x-internal-secret)
//   { type: "ride_assigned" | "ride_changed" | "ride_cancelled" | "ride_unassigned", booking_id, driver_id }
//   { type: "ride_status", booking_id, customer_id, status: "driver_assigned" | "on_the_way" | "arrived" }
//   { type: "message", booking_id, message_id, from }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

type Lang = "de" | "en" | "ar" | "ps" | "fa";
const T: Record<string, Record<Lang, string>> = {
  assigned_t: { de: "Neue Fahrt", en: "New ride", ar: "رحلة جديدة", ps: "نوی سفر", fa: "سفر جدید" },
  changed_t: { de: "Fahrt geändert", en: "Ride changed", ar: "تم تغيير الرحلة", ps: "سفر بدل شو", fa: "سفر تغییر کرد" },
  cancelled_t: { de: "Fahrt storniert", en: "Ride cancelled", ar: "تم إلغاء الرحلة", ps: "سفر لغوه شو", fa: "سفر لغو شد" },
  unassigned_t: { de: "Fahrt entfernt", en: "Ride removed", ar: "تمت إزالة الرحلة", ps: "سفر لرې شو", fa: "سفر حذف شد" },
  message_t: { de: "Neue Nachricht", en: "New message", ar: "رسالة جديدة", ps: "نوی پیغام", fa: "پیام جدید" },
  st_driver_assigned: { de: "Ihr Fahrer steht fest", en: "Your driver is assigned", ar: "تم تعيين السائق", ps: "ستاسو چلوونکی ټاکل شو", fa: "راننده شما مشخص شد" },
  st_on_the_way: { de: "Ihr Fahrer ist unterwegs", en: "Your driver is on the way", ar: "السائق في الطريق", ps: "چلوونکی په لاره دی", fa: "راننده در راه است" },
  st_arrived: { de: "Ihr Fahrer ist da", en: "Your driver has arrived", ar: "وصل السائق", ps: "چلوونکی ورسید", fa: "راننده رسید" },
};
const tr = (k: string, l: string) => (T[k]?.[(l as Lang)] ?? T[k]?.de ?? k);
const fmt = (iso: string, l: string) => new Intl.DateTimeFormat(l === "en" ? "en-GB" : "de-DE",
  { timeZone: "Europe/Berlin", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

let vapidReady = false;
async function secret(name: string) {
  const { data } = await db.rpc("get_secret", { p_name: name });
  return data as string | null;
}
async function initVapid() {
  if (vapidReady) return;
  const [pub, priv] = await Promise.all([secret("vapid_public_key"), secret("vapid_private_key")]);
  webpush.setVapidDetails("mailto:info.daydriveservice@gmail.com", pub!, priv!);
  vapidReady = true;
}

async function pushTo(userId: string | null, audience: string, payload: Record<string, unknown>) {
  if (!userId) return 0;
  const { data: subs } = await db.from("push_subscriptions").select("*").eq("user_id", userId).eq("audience", audience);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "high" });
      sent++;
      await db.from("push_subscriptions").update({ last_used_at: new Date().toISOString(), failed_count: 0 }).eq("id", s.id);
    } catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410 || s.failed_count >= 5) await db.from("push_subscriptions").delete().eq("id", s.id);
      else await db.from("push_subscriptions").update({ failed_count: s.failed_count + 1 }).eq("id", s.id);
      console.warn("push failed", code, e?.body);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const expected = await secret("internal_function_secret");
  if (!expected || req.headers.get("x-internal-secret") !== expected) return json({ ok: false, error: "forbidden" }, 403);
  try {
    await initVapid();
    const ev = await req.json();
    const { data: b } = await db.from("bookings").select("id, booking_reference, booking_start, pickup_address, destination_address, driver_id, customer_id, client_token, status, vehicle_name")
      .eq("id", ev.booking_id).maybeSingle();
    if (!b) return json({ ok: true, skipped: "booking" });

    const driverOf = async (id: string | null) => id ? (await db.from("drivers").select("auth_user_id, app_language").eq("id", id).maybeSingle()).data : null;
    const customerOf = async (id: string | null) => id ? (await db.from("customers").select("auth_user_id, language").eq("id", id).maybeSingle()).data : null;
    let sent = 0;

    if (["ride_assigned", "ride_changed", "ride_cancelled", "ride_unassigned"].includes(ev.type)) {
      const d = await driverOf(ev.driver_id);
      const l = d?.app_language || "de";
      const key = ev.type.replace("ride_", "") + "_t";
      sent += await pushTo(d?.auth_user_id, "driver", {
        title: tr(key, l), body: `${fmt(b.booking_start, l)} · ${b.pickup_address}`, tag: "ride-" + b.id,
        url: `/driver/#/ride/${b.id}`, type: ev.type, booking_id: b.id,
      });
    } else if (ev.type === "ride_status") {
      const c = await customerOf(ev.customer_id);
      const l = c?.language || "de";
      sent += await pushTo(c?.auth_user_id, "customer", {
        title: tr("st_" + ev.status, l), body: `${b.booking_reference} · ${b.vehicle_name || ""}`.trim(), tag: "ride-" + b.id,
        url: `/ride.html?b=${b.id}&t=${b.client_token}`, type: ev.type, booking_id: b.id,
      });
    } else if (ev.type === "message") {
      const { data: m } = await db.from("ride_messages").select("body, sender_type").eq("id", ev.message_id).maybeSingle();
      const preview = (m?.body || "").slice(0, 120);
      if (ev.from !== "driver") {
        const d = await driverOf(b.driver_id);
        sent += await pushTo(d?.auth_user_id, "driver", { title: tr("message_t", d?.app_language || "de"), body: preview, tag: "chat-" + b.id, url: `/driver/#/chat/${b.id}`, type: "message", booking_id: b.id });
      }
      if (ev.from !== "customer") {
        const c = await customerOf(b.customer_id);
        sent += await pushTo(c?.auth_user_id, "customer", { title: tr("message_t", c?.language || "de"), body: preview, tag: "chat-" + b.id, url: `/ride.html?b=${b.id}&t=${b.client_token}`, type: "message", booking_id: b.id });
      }
    }
    return json({ ok: true, sent });
  } catch (e) {
    console.error("push-send", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
