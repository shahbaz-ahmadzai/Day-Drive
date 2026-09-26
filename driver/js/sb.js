// Supabase connection for the driver app (own login storage, separate from the admin panel)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const CONFIG = {
  SUPABASE_URL: "https://fhvfzmbopjfldugnsoju.supabase.co",
  SUPABASE_KEY: "sb_publishable_3k0F_L47Hltmk3bOq877cg_dkpMq_pK",
  OFFICE_PHONE: "+4917643241205",
  VERSION: "1.0.0",
  // Bluetooth contract with the ESP32 starter box (see BACKEND.md)
  BLE_SERVICE: "d4d10001-7c3a-4a8e-9b2f-5a1e0c0d0001",
  BLE_TOKEN_CHAR: "d4d10002-7c3a-4a8e-9b2f-5a1e0c0d0001",
  BLE_STATUS_CHAR: "d4d10003-7c3a-4a8e-9b2f-5a1e0c0d0001",
};

export const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "dd-driver-auth" },
});

/* database function → data, or a thrown Error with the server message */
export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

/* edge function without login (driver-auth) */
export async function fn(name, body) {
  let res;
  try {
    res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${CONFIG.SUPABASE_KEY}` },
      body: JSON.stringify(body),
    });
  } catch (_) { const e = new Error("net"); e.code = "net"; throw e; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) { const e = new Error(data.error || "generic"); e.status = res.status; throw e; }
  return data;
}
