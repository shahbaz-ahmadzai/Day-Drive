// Shared lookups used by several pages (short cache so selects stay fast)
import { sb, check } from "./supabase.js";

const cache = new Map();
async function cached(key, fn, ms = 30000) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ms) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}
export const invalidate = (key) => (key ? cache.delete(key) : cache.clear());

export const vehicles = () => cached("vehicles", async () =>
  check(await sb.from("vehicles").select("id, display_name, brand, model, plate_number, category, seats, status, online_booking, price_per_km, minimum_fare, image_path, odometer_km").order("sort_order").order("display_name")));

export const drivers = () => cached("drivers", async () =>
  check(await sb.from("drivers").select("id, display_name, first_name, last_name, phone, status, employee_number").order("first_name")));

export const categories = () => cached("categories", async () =>
  check(await sb.from("finance_categories").select("*").eq("is_active", true).order("kind").order("sort_order")));

export async function settings() {
  return cached("settings", async () => {
    const rows = check(await sb.from("app_settings").select("key, value"));
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });
}
export async function saveSetting(key, value, description) {
  const row = { key, value };
  if (description) row.description = description;
  check(await sb.from("app_settings").upsert(row));
  invalidate("settings");
}

export const SERVICE_TYPES = [
  ["airport_transfer", "Airport transfer"], ["vip_executive", "VIP / executive"], ["business_travel", "Business travel"],
  ["wedding_events", "Weddings & events"], ["family_group", "Family / group"], ["school_children", "School / children"],
  ["long_term_monthly", "Long-term / monthly"], ["hourly", "Hourly service"], ["city_tour", "City tour"], ["other", "Other"],
];
export const BOOKING_STATUSES = [
  ["confirmed", "Confirmed"], ["assigned", "Driver assigned"], ["on_the_way", "On the way"], ["in_progress", "In progress"],
  ["completed", "Completed"], ["no_show", "No-show"], ["cancelled", "Cancelled"], ["pending_payment", "Awaiting payment"], ["expired", "Expired"],
];
export const PAYMENT_STATUSES = [
  ["cash_on_ride", "Pay on ride"], ["paid", "Paid"], ["invoice", "Invoice"], ["pending", "Pending"], ["failed", "Failed"],
  ["refunded", "Refunded"], ["partially_refunded", "Partially refunded"],
];
export const PAYMENT_METHODS = [
  ["cash", "Cash"], ["card", "Card"], ["bank_transfer", "Bank transfer"], ["paypal", "PayPal"], ["direct_debit", "Direct debit"], ["fuel_card", "Fuel card"], ["other", "Other"],
];
export const serviceLabel = (v) => (SERVICE_TYPES.find((s) => s[0] === v) || [, v || "–"])[1];
