// Day Drive – internet API for the ESP32 starter relay (LTE/Wi-Fi mode)
// The device sends:  POST { device_uid, ts, payload, sig }
//   ts      = unix seconds (the answer contains server_ts so the device can correct its clock)
//   payload = a JSON *string*, e.g. "{\"fw\":\"1.0\",\"state\":{\"relay\":\"off\",\"engine\":\"off\"},\"events\":[]}"
//   sig     = hex( HMAC-SHA256( device_secret, device_uid + "|" + ts + "|" + payload ) )   ← exactly the string that is sent
// Answer: { ok, allowed, shift_id, driver, server_ts, poll_seconds }  → allowed = a driver has an open shift in this car
// Over Bluetooth the device instead checks the signed token from the driver app (see BACKEND.md).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 20000) return json({ ok: false, error: "too large" }, 413);
    const b = JSON.parse(raw);
    const uid = String(b.device_uid || "");
    const ts = Number(b.ts);
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(uid) || !Number.isFinite(ts)) return json({ ok: false, error: "bad request" }, 400);
    const payloadText = typeof b.payload === "string" ? b.payload : JSON.stringify(b.payload ?? {});
    const { data, error } = await db.rpc("device_call", { p_device_uid: uid, p_ts: Math.floor(ts), p_payload_text: payloadText, p_sig: String(b.sig || "") });
    if (error) throw error;
    return json(data, data?.ok ? 200 : 401);
  } catch (e) {
    console.error("vehicle-device", e);
    return json({ ok: false, error: "server" }, 500);
  }
});
