// Monthly rides request form (monthly.html) → edge function "regular-rides" (quote + request)
import { sb, rpc, fn, T, h, put, ic, busy, toast, fail, money, todayISO, addDays, parseMoney } from "./core.js";
import { addressField, routeKm } from "./places.js";

const root = document.getElementById("mon");
const S = {
  purpose: "school", tripType: "round_trip",
  pickups: [{ place: null, time: "07:15", label: "" }],
  destination: null, destinationName: "", returnTime: "13:30",
  startDate: addDays(todayISO(), 7), endDate: addDays(todayISO(), 7 + 90),
  weekdays: [1, 2, 3, 4, 5], weekdayTimes: {}, skipPublic: true, skipSchool: true,
  passengers: 1, childSeats: 0, luggage: 1, notes: "",
  quote: null, vehicleId: null, km: null, minutes: null,
  customer: { firstName: "", lastName: "", email: "", phone: "" },
};

const seg = (items, value, onPick) => h("div", { class: "mon-seg", role: "radiogroup" }, items.map(([v, label]) =>
  h("button", { type: "button", role: "radio", "aria-checked": v === value ? "true" : "false", class: "mon-seg-btn" + (v === value ? " is-active" : ""), onClick: () => onPick(v) }, label)));
const field = (label, input, cls = "") => h("label", { class: "acc-field " + cls }, h("span", {}, label), input);
const section = (n, title, ...kids) => h("section", { class: "acc-card mon-sec" }, h("h2", {}, h("span", { class: "mon-num" }, String(n)), title), ...kids);
const invalidateQuote = () => { if (S.quote) { S.quote = null; S.vehicleId = null; drawQuote(); } };
const markDirty = (fnc) => (...a) => { fnc(...a); invalidateQuote(); };

let quoteBox, errBox;
function render() {
  const purpose = h("div");
  const drawPurpose = () => put(purpose, seg([["school", T("mon.purpose.school")], ["work", T("mon.purpose.work")], ["other", T("mon.purpose.other")]], S.purpose, (v) => { S.purpose = v; drawPurpose(); }));
  drawPurpose();

  /* pickups */
  const pickupsBox = h("div", { class: "mon-pickups" });
  const drawPickups = () => put(pickupsBox, S.pickups.map((p, i) => {
    const addr = h("input", { class: "acc-input", placeholder: T("mon.pickup.ph"), value: p.place?.address || "" });
    const wrap = h("div", { class: "mon-addr" }, addr);
    addressField(addr, markDirty((pl) => { p.place = pl; }));
    const tm = h("input", { class: "acc-input", type: "time", value: p.time }); tm.addEventListener("change", () => { p.time = tm.value; });
    const lb = h("input", { class: "acc-input", value: p.label, maxlength: "60" }); lb.addEventListener("input", () => { p.label = lb.value; });
    return h("div", { class: "mon-pickup" },
      h("div", { class: "acc-row between" }, h("strong", {}, T("mon.pickup", { n: i + 1 })),
        S.pickups.length > 1 ? h("button", { type: "button", class: "acc-link is-danger", onClick: () => { S.pickups.splice(i, 1); drawPickups(); invalidateQuote(); } }, T("mon.pickup.remove")) : null),
      wrap, h("div", { class: "acc-grid-2" }, field(T("mon.pickup.time"), tm), field(T("mon.pickup.label"), lb)));
  }), S.pickups.length < 6 ? h("button", { type: "button", class: "btn btn-outline-gold", onClick: () => {
    const last = S.pickups[S.pickups.length - 1];
    const [hh, mm] = (last.time || "07:15").split(":").map(Number); const tt = new Date(0, 0, 0, hh, (mm || 0) + 10);
    S.pickups.push({ place: null, time: `${String(tt.getHours()).padStart(2, "0")}:${String(tt.getMinutes()).padStart(2, "0")}`, label: "" }); drawPickups(); invalidateQuote();
  } }, "+ ", T("mon.pickup.add")) : null);
  drawPickups();

  /* destination */
  const dAddr = h("input", { class: "acc-input", placeholder: T("mon.destination.ph"), value: S.destination?.address || "" });
  const dWrap = h("div", { class: "mon-addr" }, dAddr);
  const dName = h("input", { class: "acc-input", value: S.destinationName, maxlength: "120" });
  dName.addEventListener("input", () => { S.destinationName = dName.value; });
  addressField(dAddr, markDirty((pl) => { S.destination = pl; if (pl && !S.destinationName && pl.name && pl.name !== pl.address) { S.destinationName = pl.name; dName.value = pl.name; } }));

  /* trip type */
  const trip = h("div");
  const ret = h("input", { class: "acc-input", type: "time", value: S.returnTime }); ret.addEventListener("change", () => { S.returnTime = ret.value; });
  const retField = field(T("mon.return"), ret);
  const drawTrip = () => { put(trip, seg([["one_way", T("mon.trip.one_way")], ["round_trip", T("mon.trip.round_trip")]], S.tripType, markDirty((v) => { S.tripType = v; drawTrip(); }))); retField.hidden = S.tripType !== "round_trip"; drawDayTimes(); };

  /* dates & weekdays */
  const start = h("input", { class: "acc-input", type: "date", min: todayISO(), value: S.startDate });
  const end = h("input", { class: "acc-input", type: "date", min: todayISO(), value: S.endDate });
  start.addEventListener("change", markDirty(() => { S.startDate = start.value; if (end.value < start.value) { end.value = start.value; S.endDate = start.value; } }));
  end.addEventListener("change", markDirty(() => { S.endDate = end.value; }));
  const days = h("div", { class: "mon-days" });
  const drawDays = () => put(days, [1, 2, 3, 4, 5, 6, 7].map((d) => h("button", { type: "button", class: "mon-day" + (S.weekdays.includes(d) ? " is-active" : ""), "aria-pressed": S.weekdays.includes(d) ? "true" : "false",
    onClick: markDirty(() => { S.weekdays = S.weekdays.includes(d) ? S.weekdays.filter((x) => x !== d) : [...S.weekdays, d].sort(); drawDays(); drawDayTimes(); }) }, T("acc.days." + d))));
  drawDays();
  const dayTimes = h("div", { class: "mon-daytimes" });
  const dtBox = h("details", { class: "acc-counter" }, h("summary", {}, T("mon.dayTimes")), dayTimes);
  function drawDayTimes() {
    put(dayTimes, S.weekdays.map((d) => {
      const cur = S.weekdayTimes[d] || {};
      const o = h("input", { class: "acc-input", type: "time", value: cur.outbound || "" });
      const r = h("input", { class: "acc-input", type: "time", value: cur.return || "", hidden: S.tripType !== "round_trip" });
      const upd = () => { const v = {}; if (o.value) v.outbound = o.value; if (r.value && S.tripType === "round_trip") v.return = r.value; if (Object.keys(v).length) S.weekdayTimes[d] = v; else delete S.weekdayTimes[d]; };
      o.addEventListener("change", upd); r.addEventListener("change", upd);
      return h("div", { class: "mon-dt" }, h("b", {}, T("acc.days." + d)), field(T("mon.dayTimes.out"), o), S.tripType === "round_trip" ? field(T("mon.dayTimes.back"), r) : null);
    }));
  }
  const chk = (label, key) => { const c = h("input", { type: "checkbox", checked: S[key] }); c.addEventListener("change", markDirty(() => { S[key] = c.checked; })); return h("label", { class: "acc-check" }, c, h("span", {}, label)); };

  /* people */
  const num = (key, min, max) => { const i = h("input", { class: "acc-input", type: "number", min: String(min), max: String(max), value: String(S[key]) }); i.addEventListener("change", () => { S[key] = Math.max(min, Math.min(max, Math.round(Number(i.value) || min))); i.value = S[key]; if (key === "passengers") invalidateQuote(); }); return i; };
  const notes = h("textarea", { class: "acc-input", rows: 3, maxlength: "1000" }); notes.value = S.notes; notes.addEventListener("input", () => { S.notes = notes.value; });

  /* quote */
  quoteBox = h("div", { class: "mon-quote" });
  const offerPrice = h("input", { class: "acc-input", inputmode: "decimal", placeholder: "25,00" });
  const offerNote = h("input", { class: "acc-input", maxlength: "500" });

  /* contact */
  const c = S.customer;
  const inp = (key, type, ac) => { const i = h("input", { class: "acc-input", type, autocomplete: ac, value: c[key] }); i.addEventListener("input", () => { c[key] = i.value; }); return i; };
  const terms = h("input", { type: "checkbox" });
  errBox = h("p", { class: "acc-err", role: "alert" });
  const sendBtn = h("button", { type: "button", class: "btn btn-gold btn-lg btn-block", onClick: () => submit(sendBtn, { offerPrice, offerNote, terms }) }, T("mon.send"));

  drawTrip();
  put(root,
    h("header", { class: "mon-hero" },
      h("p", { class: "eyebrow" }, T("mon.kicker")), h("h1", {}, T("mon.title")), h("p", { class: "acc-lead" }, T("mon.lead")),
      h("ol", { class: "mon-how" }, [1, 2, 3, 4].map((n) => h("li", {}, h("span", {}, String(n)), T("mon.how" + n))))),
    section(1, T("mon.s.purpose"), purpose),
    section(2, T("mon.s.pickups"), pickupsBox),
    section(3, T("mon.s.destination"), dWrap, field(T("mon.destination.name"), dName)),
    section(4, T("mon.s.trip"), trip, retField),
    section(5, T("mon.s.dates"), h("div", { class: "acc-grid-2" }, field(T("mon.start"), start), field(T("mon.end"), end)),
      h("p", { class: "acc-label" }, T("mon.weekdays")), days, dtBox, chk(T("mon.skipPublic"), "skipPublic"), chk(T("mon.skipSchool"), "skipSchool")),
    section(6, T("mon.s.people"), h("div", { class: "acc-grid-3" }, field(T("mon.passengers"), num("passengers", 1, 8)), field(T("mon.childSeats"), num("childSeats", 0, 6)), field(T("mon.luggage"), num("luggage", 0, 10))),
      field(T("mon.notes"), notes)),
    section(7, T("mon.s.price"), quoteBox,
      h("details", { class: "acc-counter" }, h("summary", {}, T("mon.offer")), h("div", { class: "acc-grid-2" }, field(T("mon.offer.price"), offerPrice), field(T("mon.offer.note"), offerNote)))),
    section(8, T("mon.s.contact"),
      h("div", { class: "acc-grid-2" }, field(T("mon.firstName"), inp("firstName", "text", "given-name")), field(T("mon.lastName"), inp("lastName", "text", "family-name")),
        field(T("mon.email"), inp("email", "email", "email")), field(T("mon.phone"), inp("phone", "tel", "tel"))),
      h("label", { class: "acc-check" }, terms, h("span", {}, T("mon.terms"))),
      errBox, sendBtn));
  drawQuote();
}

/* the plan in the shape the edge function expects */
function plan() {
  return {
    purpose: S.purpose, tripType: S.tripType,
    pickups: S.pickups.map((p) => ({ address: p.place?.address, lat: p.place?.lat, lng: p.place?.lng, placeId: p.place?.placeId, time: p.time, label: p.label.trim() || null })),
    destination: S.destination ? { ...S.destination, name: S.destinationName.trim() || null } : null,
    returnTime: S.tripType === "round_trip" ? S.returnTime : null,
    startDate: S.startDate, endDate: S.endDate, weekdays: S.weekdays, weekdayTimes: S.weekdayTimes,
    skipPublicHolidays: S.skipPublic, skipSchoolHolidays: S.skipSchool,
    passengers: S.passengers, childSeats: S.childSeats, luggage: S.luggage, notes: S.notes.trim() || null,
    estimatedKm: S.km, estimatedMinutes: S.minutes, vehicleId: S.vehicleId,
  };
}
function checkPlan() {
  for (let i = 0; i < S.pickups.length; i++) if (!S.pickups[i].place || !S.pickups[i].time) return T("mon.err.pickup", { n: i + 1 });
  if (!S.destination) return T("mon.err.destination");
  if (S.tripType === "round_trip" && !S.returnTime) return T("mon.err.return");
  if (!S.startDate || !S.endDate || S.endDate < S.startDate) return T("mon.err.dates");
  if (!S.weekdays.length) return T("mon.err.days");
  return "";
}

function drawQuote() {
  if (!quoteBox) return;
  const btn = h("button", { type: "button", class: "btn btn-gold", onClick: () => getQuote(btn) }, S.quote ? T("mon.quote.again") : T("mon.quote"));
  if (!S.quote) { put(quoteBox, h("p", { class: "acc-muted" }, T("mon.quote.fill")), btn); return; }
  const q = S.quote;
  put(quoteBox,
    h("p", { class: "mon-sum" }, T("mon.quote.summary", { days: q.day_count, rides: q.ride_count }), S.km ? ` · ${String(S.km).replace(".", ",")} km` : ""),
    (q.vehicles || []).length ? h("div", { class: "mon-vehicles", role: "radiogroup" }, q.vehicles.map((v) => h("button", { type: "button", role: "radio", "aria-checked": S.vehicleId === v.vehicle_id ? "true" : "false",
      class: "mon-vehicle" + (S.vehicleId === v.vehicle_id ? " is-active" : ""), onClick: () => { S.vehicleId = v.vehicle_id; drawQuote(); } },
      h("span", { class: "mon-v-name" }, h("b", {}, v.name), h("small", {}, [v.category, v.seats ? T("mon.seats", { n: v.seats }) : null].filter(Boolean).join(" · "))),
      h("span", { class: "mon-v-price" }, h("b", {}, money(v.price_per_ride)), h("small", {}, T("mon.quote.perRide")), h("small", {}, T("mon.quote.total", { total: money(v.total) }))))))
      : h("p", { class: "acc-warnline" }, T("mon.quote.noVehicles")),
    btn);
}
async function getQuote(btn) {
  const problem = checkPlan();
  if (problem) { toast(problem, "error"); return; }
  await busy(btn, async () => {
    try {
      const pts = [...S.pickups.map((p) => p.place), S.destination];
      const r = await routeKm(pts);
      S.km = r?.km ?? null; S.minutes = r?.minutes ?? null;
      const q = await fn("regular-rides", { action: "quote", plan: plan() });
      S.quote = q; S.km = q.estimated_km ?? S.km;
      if (!q.vehicles?.some((v) => v.vehicle_id === S.vehicleId)) S.vehicleId = q.vehicles?.length === 1 ? q.vehicles[0].vehicle_id : null;
      drawQuote();
    } catch (e) { fail(e); }
  });
}

async function submit(btn, { offerPrice, offerNote, terms }) {
  errBox.textContent = "";
  const problem = checkPlan() || (!S.quote || !S.vehicleId ? T("mon.err.vehicle") : "")
    || (!S.customer.firstName.trim() || !S.customer.lastName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(S.customer.email.trim()) || S.customer.phone.replace(/\D/g, "").length < 7 ? T("mon.err.contact") : "")
    || (!terms.checked ? T("mon.err.terms") : "");
  if (problem) { errBox.textContent = problem; return; }
  const offer = parseMoney(offerPrice.value);
  await busy(btn, async () => {
    try {
      const r = await fn("regular-rides", {
        action: "request", plan: plan(), termsAccepted: true,
        customer: { firstName: S.customer.firstName.trim(), lastName: S.customer.lastName.trim(), email: S.customer.email.trim(), phone: S.customer.phone.trim(), language: window.DD_LANG === "de" ? "de" : "en" },
        offer: offer > 0 ? { pricePerRide: offer, note: offerNote.value.trim() || null } : null,
      });
      put(root, h("section", { class: "acc-card acc-center mon-done" },
        h("div", { class: "mon-done-ic" }, ic("check")),
        h("h1", {}, T("mon.done.title")),
        h("p", { class: "acc-lead" }, T("mon.done.lead", { ref: r.reference })),
        h("p", { class: "mon-sum" }, T("mon.quote.summary", { days: r.dayCount, rides: r.rideCount }), " · ", money(r.pricePerRide), " ", T("mon.quote.perRide")),
        h("a", { class: "btn btn-gold", href: "account.html" }, T("mon.done.account"))));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { errBox.textContent = e.message; }
  });
}

/* logged-in customers get their details filled in */
(async () => {
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) {
      const ov = await rpc("customer_overview");
      const c = ov?.customer || {};
      Object.assign(S.customer, { firstName: c.first_name || "", lastName: c.last_name || "", email: c.email || "", phone: c.phone || "" });
    }
  } catch (_) {}
  render();
})();
document.addEventListener("dd:langchange", render);
