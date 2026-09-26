// Day Drive – regular / monthly rides (public part, website + customer app)
//   { action: "quote",   plan }            → ride days, number of rides, starting price per vehicle
//   { action: "request", plan, customer, offer? } → saves a request (status "request"); the office checks and answers
// Everything after the request (offers, accept, pause, cancel days) uses the logged-in customer + database RPCs.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
class UserError extends Error {}
const URL_ = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const str = (v: unknown, n = 300) => String(v ?? "").trim().slice(0, n);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const rad = (v: number) => (v * Math.PI) / 180;
const km = (a: any, b: any) => {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
};
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + "T00:00:00Z"));
const isTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function point(p: any, label: string) {
  const lat = num(p?.lat), lng = num(p?.lng), address = str(p?.address);
  if (!address || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new UserError(label + " is invalid.");
  return { address, lat, lng, placeId: p?.placeId ? str(p.placeId) : null };
}

/* validates the plan the customer filled in */
async function cleanPlan(p: any) {
  if (!p || typeof p !== "object") throw new UserError("The ride plan is missing.");
  const tripType = p.tripType === "one_way" ? "one_way" : "round_trip";
  const pickupsIn = Array.isArray(p.pickups) ? p.pickups : [];
  if (!pickupsIn.length) throw new UserError("Add at least one pickup point.");
  if (pickupsIn.length > 6) throw new UserError("At most 6 pickup points.");
  const pickups = pickupsIn.map((x: any, i: number) => {
    const pt = point(x, "Pickup " + (i + 1));
    const time = str(x.time, 5);
    if (!isTime(time)) throw new UserError("Enter a pickup time for pickup " + (i + 1) + ".");
    return { ...pt, label: str(x.label, 60) || null, time };
  });
  const destination = { ...point(p.destination, "Destination"), name: str(p.destination?.name, 120) || null };
  const returnTime = tripType === "round_trip" ? str(p.returnTime, 5) : null;
  if (tripType === "round_trip" && !isTime(returnTime!)) throw new UserError("Enter the pickup time for the way back.");
  const startDate = str(p.startDate, 10), endDate = str(p.endDate, 10);
  if (!isDate(startDate) || !isDate(endDate)) throw new UserError("Choose the start and end date.");
  const weekdays = (Array.isArray(p.weekdays) ? p.weekdays : [1, 2, 3, 4, 5]).map(Number).filter((d: number) => d >= 1 && d <= 7);
  if (!weekdays.length) throw new UserError("Choose at least one weekday.");
  const excluded = (Array.isArray(p.excludedDates) ? p.excludedDates : []).map((d: unknown) => str(d, 10)).filter(isDate).slice(0, 400);
  const weekdayTimes: Record<string, any> = {};
  if (p.weekdayTimes && typeof p.weekdayTimes === "object") {
    for (const [k, v] of Object.entries(p.weekdayTimes)) {
      if (!/^[1-7]$/.test(k) || typeof v !== "object" || !v) continue;
      const o: any = {};
      if (isTime(str((v as any).outbound, 5))) o.outbound = str((v as any).outbound, 5);
      if (isTime(str((v as any).return, 5))) o.return = str((v as any).return, 5);
      if (Object.keys(o).length) weekdayTimes[k] = o;
    }
  }
  // distance of one leg: pickups in order → destination; never shorter than the straight line
  const pts = [...pickups, destination];
  let straight = 0; for (let i = 1; i < pts.length; i++) straight += km(pts[i - 1], pts[i]);
  let estKm = num(p.estimatedKm);
  if (!Number.isFinite(estKm) || estKm < straight * 0.95) estKm = straight * 1.3;
  estKm = Math.round(estKm * 100) / 100;
  let estMin = Math.round(num(p.estimatedMinutes));
  if (!Number.isFinite(estMin) || estMin < 5) estMin = Math.max(10, Math.round(estKm / 40 * 60) + (pickups.length - 1) * 3);

  // the first pickup must be inside a service area
  const { data: areas } = await db.from("service_areas").select("latitude, longitude, pickup_radius_km").eq("is_active", true);
  const inside = (areas || []).some((a) => km({ lat: num(a.latitude), lng: num(a.longitude) }, pickups[0]) <= num(a.pickup_radius_km));
  if (!inside) throw new UserError("The pickup is outside our service area.");

  return {
    tripType, pickups, destination, returnTime, startDate, endDate, weekdays, excluded, weekdayTimes,
    skipPublic: p.skipPublicHolidays !== false, skipSchool: p.skipSchoolHolidays === true,
    estKm, estMin, vehicleId: p.vehicleId ? str(p.vehicleId, 60) : null,
    purpose: ["school", "work"].includes(p.purpose) ? p.purpose : "other",
    passengers: Math.max(1, Math.min(20, Math.round(num(p.passengers) || 1))),
    luggage: Math.max(0, Math.min(20, Math.round(num(p.luggage) || 0))),
    childSeats: Math.max(0, Math.min(8, Math.round(num(p.childSeats) || 0))),
    children: (Array.isArray(p.children) ? p.children : []).slice(0, 8).map((c: any) => ({
      name: str(c?.name, 60), age: Number.isFinite(num(c?.age)) ? Math.round(num(c.age)) : null,
      height_cm: Number.isFinite(num(c?.height_cm)) ? Math.round(num(c.height_cm)) : null })),
    notes: str(p.notes, 1000) || null,
  };
}

async function quote(plan: Awaited<ReturnType<typeof cleanPlan>>) {
  const { data, error } = await db.rpc("contract_quote", {
    p_start: plan.startDate, p_end: plan.endDate, p_weekdays: plan.weekdays, p_trip_type: plan.tripType,
    p_excluded: plan.excluded, p_skip_public: plan.skipPublic, p_skip_school: plan.skipSchool,
    p_vehicle_id: plan.vehicleId, p_km: plan.estKm,
  });
  if (error) throw new UserError(error.message);
  // fewer seats than passengers → not offered
  data.vehicles = (data.vehicles || []).filter((v: any) => !v.seats || v.seats >= plan.passengers);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    const plan = await cleanPlan(b.plan);

    if (b.action === "quote") {
      const q = await quote(plan);
      return json({ success: true, ...q, estimated_km: plan.estKm, estimated_minutes: plan.estMin });
    }

    if (b.action === "request") {
      const c = b.customer || {};
      const firstName = str(c.firstName, 80), lastName = str(c.lastName, 80);
      const email = str(c.email, 160).toLowerCase(), phone = str(c.phone, 40);
      const language = ["en", "de", "ar", "ps", "fa"].includes(c.language) ? c.language : "de";
      if (!firstName || !lastName) throw new UserError("Please enter your name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Please enter a valid e-mail address.");
      if (phone.replace(/\D/g, "").length < 7) throw new UserError("Please enter your mobile number.");
      if (b.termsAccepted !== true) throw new UserError("Please accept the terms.");
      if (!plan.vehicleId) throw new UserError("Please choose a vehicle.");

      const q = await quote(plan);
      const v = (q.vehicles || []).find((x: any) => x.vehicle_id === plan.vehicleId);
      if (!v) throw new UserError("This vehicle is not available for this plan.");
      if (!q.ride_count) throw new UserError("There are no ride days in this period.");

      const { data: cust, error: ce } = await db.from("customers")
        .upsert({ email, first_name: firstName, last_name: lastName, phone, language }, { onConflict: "email" }).select("id").single();
      if (ce) throw ce;
      const since = new Date(Date.now() - 86400000).toISOString();
      const { count } = await db.from("ride_contracts").select("id", { count: "exact", head: true }).eq("customer_id", cust.id).gte("created_at", since);
      if ((count ?? 0) >= 3) throw new UserError("You have already sent several requests today. We will contact you.");

      const { data: row, error } = await db.from("ride_contracts").insert({
        customer_id: cust.id, status: "request", purpose: plan.purpose, trip_type: plan.tripType,
        destination_name: plan.destination.name, destination_address: plan.destination.address,
        destination_lat: plan.destination.lat, destination_lng: plan.destination.lng, destination_place_id: plan.destination.placeId,
        return_time: plan.returnTime, start_date: plan.startDate, end_date: plan.endDate, weekdays: plan.weekdays,
        weekday_times: plan.weekdayTimes, skip_public_holidays: plan.skipPublic, skip_school_holidays: plan.skipSchool,
        excluded_dates: plan.excluded, passengers: plan.passengers, luggage: plan.luggage, child_seats: plan.childSeats,
        children: plan.children, customer_notes: plan.notes, language, requested_vehicle_id: plan.vehicleId,
        estimated_km: plan.estKm, estimated_minutes: plan.estMin, ride_count: q.ride_count, initial_price_per_ride: v.price_per_ride,
      }).select("id, reference").single();
      if (error) throw error;
      const { error: pe } = await db.from("ride_contract_pickups").insert(plan.pickups.map((p, i) => ({
        contract_id: row.id, sort_order: i, label: p.label, address: p.address, lat: p.lat, lng: p.lng, place_id: p.placeId, pickup_time: p.time,
      })));
      if (pe) throw pe;
      const offer = num(b.offer?.pricePerRide);
      if (Number.isFinite(offer) && offer > 0) {
        await db.from("ride_contract_offers").insert({ contract_id: row.id, from_party: "customer", price_per_ride: Math.round(offer * 100) / 100, note: str(b.offer?.note, 1000) || null });
        await db.from("ride_contracts").update({ status: "negotiating" }).eq("id", row.id);
      }
      // tell the office (runs on after the answer)
      const job = fetch(URL_ + "/functions/v1/booking-sms", {
        method: "POST", headers: { Authorization: "Bearer " + SERVICE, apikey: SERVICE, "Content-Type": "application/json" },
        body: JSON.stringify({ template: "office", kind: "contract", text:
          `Neue Anfrage Monatsfahrt ${row.reference}\n${firstName} ${lastName}, ${phone}\n${plan.startDate} – ${plan.endDate}, ${q.ride_count} Fahrten\n` +
          `Startpreis ${v.price_per_ride} €/Fahrt` + (Number.isFinite(offer) && offer > 0 ? ` · Kundenangebot ${offer} €` : "") }),
      }).catch((e) => console.warn("office sms", e));
      // @ts-ignore EdgeRuntime exists on Supabase
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(job);

      return json({ success: true, contractId: row.id, reference: row.reference, rideCount: q.ride_count, dayCount: q.day_count,
        pricePerRide: v.price_per_ride, total: v.total, status: Number.isFinite(offer) && offer > 0 ? "negotiating" : "request" });
    }
    return json({ success: false, error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof UserError) return json({ success: false, error: e.message }, 400);
    console.error("regular-rides", e);
    return json({ success: false, error: "Something went wrong. Please try again or call us." }, 500);
  }
});
