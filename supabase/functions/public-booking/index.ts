// Day Drive – public booking API for the website (booking.html)
// One function, four actions:
//   { action: "config" }                                   → service areas + booking rules
//   { action: "vehicles", trip }                           → free vehicles with server-side prices
//   { action: "create",   booking }                        → saves the booking and reserves the vehicle
//        payment mode "pay_on_ride" (live now): confirmed at once, paid to the driver, SMS confirmation sent
//        payment mode "online" (after PayPal):  "pending_payment" hold until the payment is captured
//   { action: "cancel",   bookingId, clientToken, reason } → releases a pending (unpaid online) booking
// The website never writes to the tables directly; everything is checked here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
class UserError extends Error { status = 400; }

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const STORAGE_PUBLIC = Deno.env.get("SUPABASE_URL") + "/storage/v1/object/public/vehicle-images/";
const FRA_AIRPORT = { lat: 50.0379, lng: 8.5622 };
const SERVICE_TYPES = ["airport_transfer","vip_executive","business_travel","wedding_events","family_group","school_children","long_term_monthly","hourly","city_tour","other"];

/* ---------------- helpers ---------------- */
const rad = (v: number) => (v * Math.PI) / 180;
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);
function point(p: any, label: string) {
  const lat = num(p?.lat), lng = num(p?.lng), address = str(p?.address, 300);
  if (!address || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new UserError(label + " is invalid.");
  return { address, lat, lng, placeId: p?.placeId ? str(p.placeId, 300) : null };
}

async function loadSettings() {
  const { data, error } = await db.from("app_settings").select("key, value");
  if (error) throw error;
  const s: Record<string, any> = {};
  (data || []).forEach((r) => (s[r.key] = r.value));
  return {
    minNotice: num(s["booking.min_notice_minutes"] ?? 60),
    holdMinutes: num(s["booking.payment_hold_minutes"] ?? 15),
    buffer: num(s["booking.buffer_minutes"] ?? 60),
    maxStops: num(s["booking.max_stops"] ?? 5),
    waitRate: num(s["booking.wait_rate_per_minute"] ?? 0.25),
    longTripKm: num(s["booking.long_trip_km"] ?? 80),
    longTripMultiplier: num(s["booking.long_trip_multiplier"] ?? 1.5),
    night: s["booking.night_hours"] ?? { from: "22:00", to: "06:00" },
    paymentMode: s["booking.payment_mode"] === "online" ? "online" : "pay_on_ride",
    autoSms: s["notifications.auto_sms_website"] !== false && s["notifications.sms_on_confirmation"] !== false,
  };
}
async function loadAreas() {
  const [{ data: areas, error }, { data: company }] = await Promise.all([
    db.from("service_areas").select("id, name, latitude, longitude, pickup_radius_km").eq("is_active", true).order("sort_order"),
    db.from("company_profile").select("booking_enabled").eq("id", 1).maybeSingle(),
  ]);
  if (error) throw error;
  return { areas: company?.booking_enabled === false ? [] : (areas || []), enabled: company?.booking_enabled !== false };
}

/* validates the trip sent by the website and returns a clean copy */
function cleanTrip(t: any, rules: Awaited<ReturnType<typeof loadSettings>>) {
  if (!t || typeof t !== "object") throw new UserError("Trip is missing.");
  const pickup = point(t.pickup, "Pickup"), destination = point(t.destination, "Destination");
  const stopsIn = Array.isArray(t.stops) ? t.stops : [];
  if (stopsIn.length > rules.maxStops) throw new UserError("Too many stops.");
  const stops = stopsIn.map((s: any, i: number) => ({ ...point(s, "Stop " + (i + 1)), waitMinutes: Math.max(0, Math.min(240, Math.round(num(s.waitMinutes) || 0))) }));
  const start = new Date(t.bookingStart);
  if (!Number.isFinite(start.getTime())) throw new UserError("Pickup time is invalid.");
  if (start.getTime() < Date.now() + (rules.minNotice - 2) * 60000) throw new UserError("The pickup time must be at least " + rules.minNotice + " minutes from now.");
  if (start.getTime() > Date.now() + 366 * 86400000) throw new UserError("Bookings are possible up to one year ahead.");
  const pts = [pickup, ...stops, destination];
  let straight = 0; for (let i = 1; i < pts.length; i++) straight += km(pts[i - 1], pts[i]);
  let distanceKm = num(t.distanceKm);
  // the route can't be shorter than the straight line; protects the price
  if (!Number.isFinite(distanceKm) || distanceKm < straight * 0.95) distanceKm = straight * 1.3;
  distanceKm = Math.round(distanceKm * 100) / 100;
  let driving = Math.round(num(t.drivingDurationMinutes));
  if (!Number.isFinite(driving) || driving < 1) driving = Math.max(5, Math.round(distanceKm / 55 * 60));
  const waitMinutes = stops.reduce((s: number, x: any) => s + x.waitMinutes, 0);
  const durationMinutes = driving + waitMinutes;
  return {
    pickup, destination, stops, start, end: new Date(start.getTime() + durationMinutes * 60000),
    distanceKm, drivingDurationMinutes: driving, waitMinutes, durationMinutes,
    routeSource: str(t.routeSource, 20) || null, language: t.language === "en" ? "en" : "de",
  };
}
function areaFor(p: { lat: number; lng: number }, areas: any[]) {
  return areas.find((a) => km({ lat: num(a.latitude), lng: num(a.longitude) }, p) <= num(a.pickup_radius_km)) || null;
}
function isNight(d: Date, night: { from: string; to: string }) {
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };
  const t = toMin(hm), f = toMin(night.from || "22:00"), e = toMin(night.to || "06:00");
  return f > e ? t >= f || t < e : t >= f && t < e;
}
function priceFor(v: any, trip: ReturnType<typeof cleanTrip>, rules: Awaited<ReturnType<typeof loadSettings>>) {
  let p = Math.max(trip.distanceKm * num(v.price_per_km), num(v.minimum_fare));
  p += trip.waitMinutes * rules.waitRate;
  const nearAirport = [trip.pickup, trip.destination].some((x) => km(x, FRA_AIRPORT) <= 3);
  if (nearAirport) p += num(v.airport_fee || 0);
  if (num(v.night_surcharge_pct) > 0 && isNight(trip.start, rules.night)) p *= 1 + num(v.night_surcharge_pct) / 100;
  if (trip.distanceKm > rules.longTripKm) p *= rules.longTripMultiplier;
  return Math.round(p * 100) / 100;
}
function imageUrl(path: string | null) {
  if (!path) return null;
  if (path.startsWith("site:")) return path.slice(5);           // image shipped with the website
  if (/^https?:\/\//.test(path)) return path;
  return STORAGE_PUBLIC + path;
}

async function availableVehicles(trip: ReturnType<typeof cleanTrip>, rules: Awaited<ReturnType<typeof loadSettings>>) {
  const { data: vehicles, error } = await db.from("vehicles")
    .select("id, display_name, category, category_label, seats, luggage_large, price_per_km, minimum_fare, airport_fee, night_surcharge_pct, image_path, description_en, description_de, sort_order")
    .eq("status", "active").eq("online_booking", true).order("sort_order");
  if (error) throw error;
  if (!vehicles?.length) return [];
  const buffer = rules.buffer * 60000;
  const from = new Date(trip.start.getTime() - buffer - 24 * 3600000).toISOString();
  const to = new Date(trip.end.getTime() + buffer).toISOString();
  const { data: busy, error: be } = await db.from("bookings")
    .select("vehicle_id, booking_start, booking_end, status, payment_status, payment_expires_at")
    .in("vehicle_id", vehicles.map((v) => v.id))
    .not("status", "in", "(cancelled,expired,no_show,completed)")
    .lt("booking_start", to).gt("booking_end", from);
  if (be) throw be;
  const now = Date.now();
  const blocked = new Set((busy || []).filter((b) => {
    if (b.status === "pending_payment" && b.payment_expires_at && new Date(b.payment_expires_at).getTime() < now) return false;
    const s = new Date(b.booking_start).getTime() - buffer, e = new Date(b.booking_end).getTime() + buffer;
    return trip.start.getTime() < e && trip.end.getTime() > s;
  }).map((b) => b.vehicle_id));
  return vehicles.filter((v) => !blocked.has(v.id)).map((v) => ({
    id: v.id, name: v.display_name, category: v.category_label || v.category, seats: v.seats, luggage: v.luggage_large,
    image_url: imageUrl(v.image_path), description: trip.language === "en" ? v.description_en : v.description_de,
    price: priceFor(v, trip, rules), currency: "EUR",
  })).sort((a, b) => a.price - b.price);
}

async function callSms(bookingId: string, template: string) {
  try {
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const r = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/booking-sms", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, template }),
    });
    if (!r.ok) console.warn("booking-sms failed", template, r.status, await r.text());
  } catch (e) { console.error("booking-sms call", e); }
}

/* ---------------- actions ---------------- */
async function actionConfig() {
  const [{ areas, enabled }, rules] = await Promise.all([loadAreas(), loadSettings()]);
  return {
    success: true, bookingEnabled: enabled,
    companies: areas.map((a) => ({ id: a.id, name: a.name, latitude: num(a.latitude), longitude: num(a.longitude), pickup_radius_km: num(a.pickup_radius_km) })),
    rules: { minNoticeMinutes: rules.minNotice, paymentHoldMinutes: rules.holdMinutes, maxStops: rules.maxStops, waitRatePerMinute: rules.waitRate, longTripKm: rules.longTripKm, longTripMultiplier: rules.longTripMultiplier, paymentMode: rules.paymentMode },
  };
}
async function actionVehicles(body: any) {
  const rules = await loadSettings();
  const trip = cleanTrip(body.trip, rules);
  const { areas } = await loadAreas();
  if (!areaFor(trip.pickup, areas)) throw new UserError("The pickup is outside our service area.");
  return { success: true, vehicles: await availableVehicles(trip, rules) };
}
async function actionCreate(body: any) {
  const b = body.booking || {};
  const rules = await loadSettings();
  const trip = cleanTrip(b.trip, rules);
  const { areas } = await loadAreas();
  const area = areaFor(trip.pickup, areas);
  if (!area) throw new UserError("The pickup is outside our service area.");

  const c = b.customer || {};
  const firstName = str(c.firstName, 80), lastName = str(c.lastName, 80);
  const email = str(c.email, 160).toLowerCase(), phone = str(c.phone, 40);
  if (!firstName || !lastName) throw new UserError("Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Please enter a valid e-mail address.");
  if (phone.replace(/\D/g, "").length < 6) throw new UserError("Please enter your phone number.");
  if (b.termsAccepted !== true) throw new UserError("Please accept the terms.");
  const passengers = Math.max(1, Math.min(20, Math.round(num(c.passengers) || 1)));
  const luggage = Math.max(0, Math.min(20, Math.round(num(c.luggage) || 0)));
  const serviceType = SERVICE_TYPES.includes(b.serviceType) ? b.serviceType : "other";

  // simple abuse protection: max 3 new bookings per e-mail / phone within 30 minutes
  const since = new Date(Date.now() - 30 * 60000).toISOString();
  const recentQ = () => db.from("bookings").select("id", { count: "exact", head: true })
    .gte("created_at", since).eq("source", "website").not("status", "in", "(cancelled,expired)");
  const [{ count: byMail }, { count: byPhone }] = await Promise.all([recentQ().eq("customer_email", email), recentQ().eq("customer_phone", phone)]);
  if (Math.max(byMail ?? 0, byPhone ?? 0) >= 3) throw new UserError("You have just made several bookings. Please call us if you need more rides.");

  // re-check availability and take the SERVER price
  const vehicles = await availableVehicles(trip, rules);
  const chosen = vehicles.find((v) => v.id === str(b.vehicle?.id, 60));
  if (!chosen) throw new UserError("This vehicle has just been booked. Please choose another one.");
  if (chosen.seats && passengers > chosen.seats) throw new UserError("This vehicle has not enough seats for your group.");

  // customer record (one per e-mail)
  const { data: customer, error: ce } = await db.from("customers")
    .upsert({ email, first_name: firstName, last_name: lastName, phone, language: trip.language }, { onConflict: "email" })
    .select("id").single();
  if (ce) throw ce;

  const online = rules.paymentMode === "online";
  const expires = online ? new Date(Date.now() + rules.holdMinutes * 60000) : null;
  const { data: row, error } = await db.from("bookings").insert({
    source: "website", service_type: serviceType,
    status: online ? "pending_payment" : "confirmed", payment_status: online ? "pending" : "cash_on_ride",
    customer_id: customer.id, customer_first_name: firstName, customer_last_name: lastName, customer_email: email, customer_phone: phone,
    language: trip.language, passengers, luggage,
    flight_number: c.flightNumber ? str(c.flightNumber, 20).toUpperCase() : null,
    customer_notes: c.notes ? str(c.notes, 1000) : null,
    pickup_address: trip.pickup.address, pickup_lat: trip.pickup.lat, pickup_lng: trip.pickup.lng, pickup_place_id: trip.pickup.placeId,
    destination_address: trip.destination.address, destination_lat: trip.destination.lat, destination_lng: trip.destination.lng, destination_place_id: trip.destination.placeId,
    stops: trip.stops, service_area_id: area.id,
    booking_start: trip.start.toISOString(), booking_end: trip.end.toISOString(),
    distance_km: trip.distanceKm, driving_duration_minutes: trip.drivingDurationMinutes, wait_minutes: trip.waitMinutes,
    duration_minutes: trip.durationMinutes, route_source: trip.routeSource,
    vehicle_id: chosen.id, vehicle_name: chosen.name,
    price_amount: chosen.price, wait_fee: Math.round(trip.waitMinutes * rules.waitRate * 100) / 100, currency: "EUR",
    payment_expires_at: expires ? expires.toISOString() : null, terms_accepted_at: new Date().toISOString(),
  }).select("id, booking_reference, client_token, price_amount, payment_expires_at, ride_code, status, payment_status, booking_start").single();
  if (error) throw error;

  // confirmed straight away → SMS confirmation (does not block the answer to the website)
  let smsQueued = false;
  if (!online) {
    smsQueued = rules.autoSms;
    const job = Promise.all([rules.autoSms ? callSms(row.id, "confirmation") : null, callSms(row.id, "admin_alert")]);
    // @ts-ignore EdgeRuntime exists on Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(job); else await job;
  }

  return {
    success: true, bookingId: row.id, bookingReference: row.booking_reference, clientToken: row.client_token,
    amount: Number(row.price_amount), currency: "EUR", paymentExpiresAt: row.payment_expires_at,
    status: row.status, paymentStatus: row.payment_status, paymentMode: rules.paymentMode, rideCode: row.ride_code,
    bookingStart: row.booking_start, smsQueued,
  };
}
async function actionCancel(body: any) {
  const id = str(body.bookingId, 60), token = str(body.clientToken, 60);
  if (!id || !token) throw new UserError("Booking is missing.");
  const reason = body.reason === "expired" ? "Payment time ran out" : "Closed by the customer before payment";
  const { data, error } = await db.from("bookings")
    .update({ status: body.reason === "expired" ? "expired" : "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason })
    .eq("id", id).eq("client_token", token).eq("status", "pending_payment").eq("payment_status", "pending")
    .select("id");
  if (error) throw error;
  return { success: true, released: (data || []).length > 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "config": return json(await actionConfig());
      case "vehicles": return json(await actionVehicles(body));
      case "create": return json(await actionCreate(body));
      case "cancel": return json(await actionCancel(body));
      default: return json({ success: false, error: "Unknown action." }, 400);
    }
  } catch (e) {
    if (e instanceof UserError) return json({ success: false, error: e.message }, e.status);
    console.error("public-booking", e);
    return json({ success: false, error: "Something went wrong. Please try again or call us." }, 500);
  }
});
