// Settings: company, booking rules, notifications, integrations, team, finance, activity log
// Each section is one function in SECTIONS – add a new one there to extend the settings.
import { sb, check, callFunction } from "../core/supabase.js";
import { h, icon, btn, badge, empty, card, toast, toastError, openDrawer, confirmDialog, form, busy, dl, table, clear, put, debounce } from "../core/ui.js";
import { dateTime, relative, num, label, fullName } from "../core/format.js";
import { settings as loadSettings, saveSetting, invalidate } from "../core/data.js";
import { searchPlaces, placeDetails, createAreaMap, createOverviewMap } from "../core/maps.js";
import { can, me, ROLE_INFO, passwordProblem } from "../core/auth.js";

const isOwner = () => me().role === "owner";
const canEdit = () => can("settings.edit");

const SECTIONS = [
  { id: "company", label: "Company", icon: "building", render: company },
  { id: "areas", label: "Pickup area", icon: "pin", render: pickupAreas },
  { id: "booking", label: "Booking rules", icon: "sliders", render: booking },
  { id: "holidays", label: "Holidays", icon: "calendar", render: holidays },
  { id: "notifications", label: "Notifications", icon: "sms", render: notifications },
  { id: "integrations", label: "Integrations", icon: "plug", render: integrations },
  { id: "team", label: "Team & logins", icon: "users", render: team, show: isOwner },
  { id: "finance", label: "Finance", icon: "euro", render: finance, show: () => can("finance.view") },
  { id: "activity", label: "Activity log", icon: "clock", render: activity, show: () => can("audit.view") },
];

const actions = (...b) => h("div", { class: "form-actions", style: { marginTop: "16px" } }, ...b);
const readOnlyNote = () => (canEdit() ? null : h("div", { class: "note", style: { marginBottom: "14px" } }, "You can view these settings. Only owner/admin can change them."));

export default {
  async render(root, { params, setParams }) {
    const visible = SECTIONS.filter((s) => !s.show || s.show());
    let active = visible.find((s) => s.id === params.tab) ? params.tab : visible[0].id;
    root.append(h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Settings"), h("p", { class: "muted" }, "Company details, booking rules, connections and team."))));
    const nav = h("nav", { class: "settings-nav" });
    const pane = h("div", { class: "stack" });
    root.append(h("div", { class: "settings-layout" }, nav, pane));
    const open = async (id) => {
      active = id; setParams({ tab: id === visible[0].id ? "" : id });
      nav.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.id === id));
      put(pane, h("div", { class: "loading" }, h("span", { class: "spin" })));
      try { const els = await SECTIONS.find((s) => s.id === id).render(); put(pane, ...[els].flat().filter(Boolean)); }
      catch (e) { toastError(e); put(pane, ); }
    };
    visible.forEach((s) => nav.append(h("button", { type: "button", "data-id": s.id, onClick: () => open(s.id) }, icon(s.icon, 17), s.label)));
    open(active);
  },
};

/* ---------------- holidays (for monthly rides) ---------------- */
async function holidays() {
  const box = h("div", { class: "stack" });
  const dmy = (d) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const next = (d) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  async function draw() {
    const today = new Date().toISOString().slice(0, 10);
    const rows = check(await sb.from("holidays").select("day, kind, name").eq("region", "HE").gte("day", today).order("day").limit(2000));
    // school holidays: group consecutive days with the same name
    const ranges = [];
    for (const r of rows.filter((x) => x.kind === "school")) {
      const last = ranges[ranges.length - 1];
      if (last && last.name === r.name && next(last.to) === r.day) last.to = r.day; else ranges.push({ name: r.name, from: r.day, to: r.day });
    }
    const pub = rows.filter((x) => x.kind === "public");
    put(box,
      h("div", { class: "note" }, "Monthly rides skip these days automatically (if the customer chose it). Public holidays for Hessen are already loaded until 2028. Please add the school holidays (Hessen) – you find the dates on kultusministerium.hessen.de."),
      card("School holidays (Hessen)", [
        table({ rows: ranges, emptyEl: empty("No school holidays entered yet", "Add the holidays so school rides are not planned on those days.", null, "calendar"), columns: [
          { label: "Name", key: "name" }, { label: "From", render: (r) => dmy(r.from) }, { label: "Until", render: (r) => dmy(r.to) },
          { label: "", cls: "right", render: (r) => (canEdit() ? btn("", { small: true, ic: "x", variant: "ghost", title: "Delete", onClick: async () => {
            if (!(await confirmDialog({ title: `Delete ${r.name}?`, message: "Rides that were already cancelled for these days are not planned again automatically. Use “Resume” on the monthly ride if needed.", confirmText: "Delete", danger: true }))) return;
            try { check(await sb.from("holidays").delete().eq("region", "HE").eq("kind", "school").eq("name", r.name).gte("day", r.from).lte("day", r.to)); toast("Deleted"); draw(); } catch (e) { toastError(e); }
          } }) : null) }] }),
        canEdit() ? h("div", { class: "row", style: { marginTop: "12px" } }, btn("Add school holidays", { variant: "primary", ic: "plus", small: true, onClick: add })) : null,
      ], { sub: "Only future dates are shown." }),
      card("Public holidays (Hessen)", h("p", { class: "small" }, pub.slice(0, 40).map((x) => `${dmy(x.day)} ${x.name}`).join(" · ") || "–")));
  }
  function add() {
    const f = form([
      { name: "name", label: "Name", required: true, placeholder: "e.g. Herbstferien 2026" },
      { name: "from", label: "First day", type: "date", required: true },
      { name: "to", label: "Last day", type: "date", required: true, validate: (v, api) => (v && api.get("from") && v < api.get("from") ? "Must be after the first day" : v && api.get("from") && (new Date(v) - new Date(api.get("from"))) / 86400000 > 60 ? "At most 60 days at once" : "") },
    ], {}, { cols: 1 });
    const m = openDrawer({ title: "Add school holidays", body: f.el });
    m.setFooter([btn("Cancel", { onClick: m.close }), btn("Save", { variant: "primary", onClick: (e) => {
      if (!f.validate()) return;
      busy(e.currentTarget, async () => {
        try {
          const v = f.values(); const days = [];
          for (let d = v.from; d <= v.to; d = next(d)) days.push({ day: d, region: "HE", kind: "school", name: v.name });
          check(await sb.from("holidays").upsert(days, { onConflict: "day,region,kind" }));
          const { data: n, error } = await sb.rpc("admin_apply_holidays", { p_from: v.from, p_to: v.to });
          if (error) throw new Error(error.message);
          toast(n ? `Saved – ${n} planned monthly rides in these days were cancelled` : "Saved"); m.close(); draw();
        } catch (err) { toastError(err); }
      });
    } })]);
  }
  await draw();
  return box;
}

/* ---------------- company ---------------- */
async function company() {
  const c = check(await sb.from("company_profile").select("*").eq("id", 1).single());
  const f = form([
    { type: "section", label: "Company" },
    { name: "name", label: "Company name", required: true },
    { name: "legal_name", label: "Legal name (Impressum)" },
    { name: "managing_director", label: "Managing director / owner" },
    { name: "website", label: "Website" },
    { type: "section", label: "Address" },
    { name: "street", label: "Street" },
    { name: "house_number", label: "No." },
    { name: "postal_code", label: "Postcode" },
    { name: "city", label: "City" },
    { name: "country", label: "Country" },
    { type: "section", label: "Contact", hint: "The main phone number is used in SMS confirmations." },
    { name: "phone", label: "Main phone", type: "tel", required: true },
    { name: "second_phone", label: "Second phone", type: "tel" },
    { name: "email", label: "E-mail", type: "email" },
    { type: "section", label: "Tax & bank" },
    { name: "tax_number", label: "Tax number (Steuernummer)" },
    { name: "vat_id", label: "VAT ID (USt-IdNr.)" },
    { name: "commercial_register", label: "Commercial register" },
    { name: "bank_name", label: "Bank" },
    { name: "iban", label: "IBAN" },
    { name: "bic", label: "BIC" },
    { type: "section", label: "Online booking" },
    { name: "booking_enabled", label: "Accept bookings on the website", type: "checkbox", span: 2, hint: "Switch off e.g. during holidays. The booking page then shows that online booking is paused." },
  ], c);
  if (!canEdit()) Object.values(f.inputs).forEach(({ input }) => (input.disabled = true));
  const save = btn("Save company", { variant: "primary", onClick: () => {
    if (!f.validate()) return;
    busy(save, async () => { try { check(await sb.from("company_profile").update(f.values()).eq("id", 1)); toast("Company saved"); } catch (e) { toastError(e); } });
  } });
  const areas = check(await sb.from("service_areas").select("name, address, pickup_radius_km, is_active").order("sort_order"));
  const areaInfo = card("Company location & pickup area", h("div", { class: "row between" },
    h("div", {}, areas.length ? areas.map((a) => h("p", {}, h("strong", {}, a.name), " · ", `${num(a.pickup_radius_km, 0)} km radius`, a.address ? h("small", { class: "muted", style: { display: "block" } }, a.address) : null))
      : h("p", { class: "muted" }, "Not set yet – website bookings need a pickup area.")),
    btn(areas.length ? "Change on map" : "Set on map", { ic: "pin", variant: areas.length ? "" : "primary", onClick: () => reopen("areas") })));
  return [areaInfo, card("Company profile", h("div", {}, readOnlyNote(), f.el, canEdit() ? actions(save) : null))];
}

/* ---------------- booking rules + service areas ---------------- */
async function booking() {
  const s = await loadSettings();
  const { data: paypal } = await sb.from("integrations").select("status, enabled").eq("provider", "paypal").maybeSingle();
  const paypalReady = paypal?.status === "connected" && paypal?.enabled;
  const f = form([
    { type: "section", label: "Payment" },
    { name: "payment_mode", label: "Payment for website bookings", type: "select", span: 2,
      options: [["pay_on_ride", "Pay on the ride (cash / card to the driver) – booking confirmed immediately"], ["online", paypalReady ? "Pay online (PayPal, card, Apple Pay) before confirmation" : "Pay online – available after PayPal is connected"]],
      hint: paypalReady ? "" : "PayPal is not connected yet, so only “Pay on the ride” can be used." },
    { name: "payment_hold_minutes", label: "Reserve vehicle while paying (min)", type: "number", min: 5, max: 60 },
    { type: "section", label: "Times" },
    { name: "min_notice_minutes", label: "Minimum notice (min)", type: "number", min: 0, max: 10080, hint: "How early customers must book" },
    { name: "buffer_minutes", label: "Buffer between rides (min)", type: "number", min: 0, max: 600, hint: "Vehicle stays blocked before/after a ride" },
    { name: "max_stops", label: "Max. stops per ride", type: "number", min: 0, max: 10 },
    { type: "section", label: "Prices", hint: "Per-km prices and minimum fares are set per vehicle." },
    { name: "wait_rate_per_minute", label: "Waiting at stops (EUR / min)", type: "number", step: "0.01", min: 0 },
    { name: "long_trip_km", label: "Long trip from (km)", type: "number", min: 0 },
    { name: "long_trip_multiplier", label: "Long trip factor", type: "number", step: "0.05", min: 1, max: 3, hint: "1.5 = +50 % (return trip of the driver)" },
    { name: "night_from", label: "Night surcharge from", type: "time" },
    { name: "night_to", label: "Night surcharge until", type: "time" },
  ], {
    payment_mode: s["booking.payment_mode"] || "pay_on_ride", payment_hold_minutes: s["booking.payment_hold_minutes"],
    min_notice_minutes: s["booking.min_notice_minutes"], buffer_minutes: s["booking.buffer_minutes"], max_stops: s["booking.max_stops"],
    wait_rate_per_minute: s["booking.wait_rate_per_minute"], long_trip_km: s["booking.long_trip_km"], long_trip_multiplier: s["booking.long_trip_multiplier"],
    night_from: s["booking.night_hours"]?.from || "22:00", night_to: s["booking.night_hours"]?.to || "06:00",
  });
  if (!paypalReady) f.inputs.payment_mode.input.querySelector('option[value="online"]').disabled = true;
  if (!canEdit()) Object.values(f.inputs).forEach(({ input }) => (input.disabled = true));
  const save = btn("Save booking rules", { variant: "primary", onClick: () => {
    if (!f.validate()) return;
    busy(save, async () => {
      try {
        const v = f.values();
        if (v.payment_mode === "online" && !paypalReady) throw new Error("Connect PayPal first.");
        await Promise.all([
          saveSetting("booking.payment_mode", v.payment_mode), saveSetting("booking.payment_hold_minutes", v.payment_hold_minutes ?? 15),
          saveSetting("booking.min_notice_minutes", v.min_notice_minutes ?? 60), saveSetting("booking.buffer_minutes", v.buffer_minutes ?? 60),
          saveSetting("booking.max_stops", v.max_stops ?? 5), saveSetting("booking.wait_rate_per_minute", v.wait_rate_per_minute ?? 0),
          saveSetting("booking.long_trip_km", v.long_trip_km ?? 80), saveSetting("booking.long_trip_multiplier", v.long_trip_multiplier ?? 1),
          saveSetting("booking.night_hours", { from: v.night_from || "22:00", to: v.night_to || "06:00" }),
        ]);
        toast("Booking rules saved – the website uses them right away");
      } catch (e) { toastError(e); }
    });
  } });

  return card("Booking rules", h("div", {}, readOnlyNote(), f.el, canEdit() ? actions(save) : null), { sub: "Used by the website booking page and price calculation. The pickup area is set under “Pickup area”." });
}

/* ---------------- pickup area (company location + radius) ---------------- */
const reopen = (id) => document.querySelector(`.settings-nav [data-id="${id}"]`)?.click();
async function pickupAreas() {
  const areas = check(await sb.from("service_areas").select("*").order("sort_order"));
  const mapEl = h("div", { class: "area-map area-map-lg" }, h("div", { class: "loading" }, h("span", { class: "spin" }), "Loading map…"));
  const list = table({
    rows: areas, onRow: canEdit() ? (a) => editArea(a) : null, rowClass: (a) => (a.is_active ? "" : "is-muted"),
    emptyEl: empty("No pickup area yet", "Add your company address – customers can then book pickups inside the radius around it.",
      canEdit() ? btn("Add company location", { variant: "primary", ic: "plus", onClick: () => editArea() }) : null, "pin"),
    columns: [
      { label: "Location", render: (a) => h("div", {}, h("strong", {}, a.name), h("small", {}, a.address || `${num(a.latitude, 5)}, ${num(a.longitude, 5)}`)) },
      { label: "Pickup radius", render: (a) => h("strong", {}, `${num(a.pickup_radius_km, 0)} km`) },
      { label: "", render: (a) => badge(a.is_active ? "active" : "inactive") },
    ] });
  if (areas.length) createOverviewMap(mapEl, areas).catch((e) => put(mapEl, h("div", { class: "note red" }, e.message)));
  return [
    card("Pickup area", h("div", {}, areas.length ? mapEl : null, list), { cls: areas.length ? "" : "flush",
      sub: "The website only accepts pickups inside these circles. Search your company name or address, then set the radius.",
      actions: canEdit() && areas.length ? btn("Add location", { small: true, ic: "plus", onClick: () => editArea() }) : null }),
  ];
}

function editArea(a = null) {
  const st = {
    name: a?.name || "", address: a?.address || "", lat: a ? Number(a.latitude) : null, lng: a ? Number(a.longitude) : null,
    placeId: a?.place_id || null, radius: a ? Number(a.pickup_radius_km) : 50, active: a ? a.is_active : true,
  };
  const MAX = 200;
  let mapApi = null;

  // search
  const search = h("input", { class: "input", type: "search", placeholder: "Type the company name or address, e.g. Day Drive Service Frankfurt", autocomplete: "off" });
  const sugg = h("ul", { class: "place-suggest", hidden: true, role: "listbox" });
  const picked = h("div", { class: "place-picked" });
  const drawPicked = () => put(picked, st.lat == null ? h("p", { class: "muted small" }, "No location chosen yet.") :
    h("div", { class: "row", style: { flexWrap: "nowrap", alignItems: "flex-start" } }, icon("pin", 18),
      h("div", {}, h("strong", {}, st.name || "Chosen point"), h("small", { class: "muted", style: { display: "block" } }, st.address || `${num(st.lat, 5)}, ${num(st.lng, 5)} (point set on the map)`))));
  let seq = 0;
  const runSearch = debounce(async () => {
    const q = search.value.trim(); const my = ++seq;
    if (q.length < 3) { sugg.hidden = true; return; }
    try {
      const res = await searchPlaces(q, st.lat != null ? { lat: st.lat, lng: st.lng } : null);
      if (my !== seq) return;
      put(sugg, res.length ? res.map((r) => h("li", { role: "option", tabindex: 0, onClick: () => choose(r), onKeydown: (e) => { if (e.key === "Enter") choose(r); } },
        icon("pin", 16), h("span", {}, h("strong", {}, r.main), h("small", {}, r.secondary)))) : h("li", { class: "muted" }, "Nothing found"));
      sugg.hidden = false;
    } catch (e) { put(sugg, h("li", { class: "money-neg" }, e.message)); sugg.hidden = false; }
  }, 250);
  search.addEventListener("input", runSearch);
  search.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); sugg.hidden = true; } });
  async function choose(r) {
    sugg.hidden = true; search.value = r.main;
    try {
      const p = await placeDetails(r.prediction);
      Object.assign(st, { lat: p.lat, lng: p.lng, address: p.address, placeId: p.placeId });
      if (!nameIn.value.trim() || nameIn.dataset.auto === "1") { nameIn.value = p.name || r.main; nameIn.dataset.auto = "1"; }
      st.name = nameIn.value.trim();
      drawPicked(); mapApi?.setCenter(p.lat, p.lng);
    } catch (e) { toastError(e); }
  }

  // map
  const mapEl = h("div", { class: "area-map" }, h("div", { class: "loading" }, h("span", { class: "spin" }), "Loading map…"));
  const startMap = () => createAreaMap(mapEl, { lat: st.lat, lng: st.lng, radiusKm: st.radius,
    onMove: (la, ln) => { Object.assign(st, { lat: la, lng: ln, address: "", placeId: null }); drawPicked(); } })
    .then((m) => { mapApi = m; }).catch((e) => put(mapEl, h("div", { class: "note red" }, e.message)));

  // radius: slider + number
  const range = h("input", { type: "range", class: "range", min: 1, max: MAX, step: 1, value: st.radius, "aria-label": "Pickup radius in km" });
  const numIn = h("input", { class: "input radius-num", type: "number", min: 1, max: 500, step: 1, value: st.radius, inputmode: "numeric", "aria-label": "Pickup radius in km" });
  const paint = () => range.style.setProperty("--fill", `${(Math.min(st.radius, MAX) / MAX) * 100}%`);
  const setRadius = (v, from) => {
    v = Math.max(1, Math.min(500, Math.round(Number(v) || 0))); if (!v) return;
    st.radius = v;
    if (from !== "range") range.value = Math.min(v, MAX);
    if (from !== "num") numIn.value = v;
    paint(); mapApi?.setRadius(v);
  };
  range.addEventListener("input", () => setRadius(range.value, "range"));
  numIn.addEventListener("input", () => { if (numIn.value !== "") setRadius(numIn.value, "num"); });
  numIn.addEventListener("blur", () => setRadius(numIn.value || st.radius));
  paint();

  const nameIn = h("input", { class: "input", placeholder: "e.g. Day Drive Service – Frankfurt", value: st.name });
  nameIn.addEventListener("input", () => { nameIn.dataset.auto = "0"; st.name = nameIn.value.trim(); if (st.lat != null) drawPicked(); });
  const active = h("input", { type: "checkbox", checked: st.active });

  const body = h("div", { class: "area-editor" },
    h("label", { class: "field" }, h("span", { class: "field-label" }, "Company name or address"), h("div", { class: "place-search" }, icon("search", 16), search, sugg)),
    picked, mapEl,
    h("p", { class: "muted small", style: { margin: "6px 0 0" } }, "Tip: drag the pin or click the map to fine-tune the centre."),
    h("div", { class: "field", style: { marginTop: "18px" } },
      h("span", { class: "field-label" }, "Pickup radius"), range,
      h("div", { class: "radius-row" }, numIn, h("span", {}, "km"), h("small", { class: "muted" }, `Slider up to ${MAX} km – type a bigger number if needed.`))),
    h("label", { class: "field", style: { marginTop: "14px" } }, h("span", { class: "field-label" }, "Name shown to admins"), nameIn),
    h("label", { class: "check" }, active, h("span", {}, "Active – accept website pickups in this area")));
  drawPicked();

  const d = openDrawer({ title: a ? `Edit ${a.name}` : "Add company location", subtitle: "Customers can book pickups inside the circle.", body, wide: true });
  startMap();
  const foot = [];
  if (a) foot.push(btn("Delete", { variant: "ghost", ic: "x", onClick: async () => {
    if (!(await confirmDialog({ title: `Delete ${a.name}?`, message: "Pickups in this area will no longer be possible.", confirmText: "Delete", danger: true }))) return;
    try { check(await sb.from("service_areas").delete().eq("id", a.id)); toast("Area deleted"); d.close(); reopen("areas"); } catch (e) { toastError(e); }
  } }), h("span", { class: "spacer" }));
  foot.push(btn("Cancel", { onClick: d.close }), btn("Save", { variant: "primary", onClick: (e) => busy(e.currentTarget, async () => {
    try {
      if (st.lat == null) throw new Error("Search the company name or address first, or click the map.");
      const name = nameIn.value.trim() || st.address.split(",")[0] || "Pickup area";
      const row = { name, address: st.address || null, place_id: st.placeId, latitude: Number(st.lat.toFixed(6)), longitude: Number(st.lng.toFixed(6)),
        pickup_radius_km: st.radius, is_active: active.checked };
      if (a) check(await sb.from("service_areas").update(row).eq("id", a.id));
      else check(await sb.from("service_areas").insert({ ...row, sort_order: 10 }));
      toast("Pickup area saved – the website uses it right away"); d.close(); reopen("areas");
    } catch (err) { toastError(err); }
  }) }));
  d.setFooter(foot);
  setTimeout(() => search.focus(), 60);
}

/* ---------------- notifications ---------------- */
async function notifications() {
  const s = await loadSettings();
  const f = form([
    { name: "auto_sms", label: "Send SMS confirmation to the customer after a website booking", type: "checkbox", span: 2 },
    { name: "office_phone", label: "Office mobile for “new booking” SMS", type: "tel", span: 2, hint: "Every new website booking sends a short SMS to this number. Leave empty to switch off." },
  ], { auto_sms: s["notifications.auto_sms_website"] !== false, office_phone: s["notifications.admin_alert_phone"] || "" });
  if (!canEdit()) Object.values(f.inputs).forEach(({ input }) => (input.disabled = true));
  const save = btn("Save", { variant: "primary", onClick: () => busy(save, async () => {
    try {
      const v = f.values();
      await Promise.all([saveSetting("notifications.auto_sms_website", !!v.auto_sms), saveSetting("notifications.admin_alert_phone", v.office_phone || "")]);
      toast("Notifications saved");
    } catch (e) { toastError(e); }
  }) });
  const log = check(await sb.from("notifications").select("channel, template, recipient, status, error, created_at").order("created_at", { ascending: false }).limit(25));
  return [
    card("SMS & alerts", h("div", {}, readOnlyNote(), f.el, h("div", { class: "note", style: { marginTop: "14px" } }, "E-mail confirmations will be added when Resend is connected (needs your own domain)."), canEdit() ? actions(save) : null)),
    card("Last messages", table({ rows: log, emptyEl: empty("No messages sent yet", null, null, "sms"), columns: [
      { label: "When", render: (n) => h("span", { title: dateTime(n.created_at) }, relative(n.created_at)) },
      { label: "Type", render: (n) => `${n.channel.toUpperCase()} · ${label(n.template)}` },
      { label: "To", render: (n) => h("span", { class: "mono" }, n.recipient) },
      { label: "Status", render: (n) => h("div", {}, badge(n.status), n.error ? h("small", { class: "money-neg" }, n.error) : null) },
    ] }), { cls: "flush" }),
  ];
}

/* ---------------- integrations ---------------- */
const INTEG_INFO = {
  google_maps: { icon: "pin", text: "Address search, route and distance on the booking page. The browser key is in js/dd-booking-api.js." },
  twilio: { icon: "sms", text: "SMS booking confirmations and office alerts. Account SID and token are stored encrypted in Supabase Vault." },
  paypal: { icon: "wallet", text: "Online payment with PayPal, credit card and Apple Pay. Planned – once connected, switch Booking rules → Payment to “online”." },
  resend: { icon: "mail", text: "E-mail confirmations and the Inbox. Planned – needs the website's own domain." },
};
async function integrations() {
  const rows = check(await sb.from("integrations").select("*").order("category").order("provider"));
  const list = h("div", {});
  const draw = () => put(list, ...rows.map((r) => {
    const info = INTEG_INFO[r.provider] || { icon: "plug", text: r.notes || "" };
    const side = h("div", { class: "integ-side" }, badge(r.status), r.enabled ? null : badge("off", "grey"));
    if (r.provider === "twilio" && canEdit()) side.append(btn("Configure", { small: true, onClick: () => configureTwilio(r) }));
    if (r.provider === "twilio" && can("bookings.edit")) side.append(btn("Test SMS", { small: true, ic: "sms", onClick: () => testSms() }));
    return h("div", { class: "integ" }, h("div", { class: "integ-ic" }, icon(info.icon, 20)),
      h("div", { class: "integ-main" }, h("h3", {}, r.display_name || label(r.provider)), h("p", { class: "muted small" }, info.text),
        r.last_tested_at ? h("p", { class: "small muted" }, `Last used ${relative(r.last_tested_at)}${r.last_error ? " · " : ""}`, r.last_error ? h("span", { class: "money-neg" }, r.last_error) : null) : null,
        r.provider === "twilio" && r.public_config ? h("p", { class: "small" }, `Sender: ${r.public_config.sender_name || "–"} · Number: ${r.public_config.from_number || "–"}`) : null),
      side);
  }));
  draw();

  function configureTwilio(r) {
    const cfg = r.public_config || {};
    const f = form([
      { name: "enabled", label: "SMS switched on", type: "checkbox", span: 2 },
      { name: "sender_name", label: "Sender name", hint: "Max. 11 letters/numbers, shown instead of a number (works in Germany)." ,
        validate: (v) => (v && !/^[A-Za-z0-9 ]{1,11}$/.test(v) ? "Max. 11 letters or numbers" : "") },
      { name: "from_number", label: "Twilio phone number", type: "tel", hint: "Used when the sender name is refused." },
      { name: "default_country_code", label: "Default country code", placeholder: "+49" },
    ], { enabled: r.enabled, ...cfg });
    const d = openDrawer({ title: "Twilio SMS", subtitle: "The Account SID and Auth Token are kept in Supabase Vault and never shown in the browser.", body: f.el });
    d.setFooter([btn("Cancel", { onClick: d.close }), btn("Save", { variant: "primary", onClick: (e) => {
      if (!f.validate()) return;
      busy(e.currentTarget, async () => {
        try {
          const v = f.values();
          const public_config = { ...cfg, sender_name: v.sender_name || null, from_number: v.from_number || null, default_country_code: v.default_country_code || "+49" };
          check(await sb.from("integrations").update({ enabled: v.enabled, public_config }).eq("provider", "twilio"));
          Object.assign(r, { enabled: v.enabled, public_config }); draw(); toast("Twilio saved"); d.close();
        } catch (err) { toastError(err); }
      });
    } })]);
  }
  async function testSms() {
    const phone = await confirmDialog({ title: "Send a test SMS", message: "Enter a mobile number. Twilio trial accounts can only send to verified numbers.", confirmText: "Send", input: { label: "Mobile number", placeholder: "0176 …", required: true } });
    if (!phone) return;
    try { const res = await callFunction("booking-sms", { template: "test", phone }); toast(`Test SMS sent to ${res.to} (from ${res.from})`); const t = rows.find((x) => x.provider === "twilio"); Object.assign(t, { status: "connected", last_tested_at: new Date().toISOString(), last_error: null }); draw(); }
    catch (e) { toastError(e); }
  }
  return [card("Connected services", list, { cls: "flush", sub: "More services can be added here later (accounting, calendar, partner platforms…)." })];
}

/* ---------------- team ---------------- */
async function team() {
  const rows = check(await sb.from("admin_users").select("*").order("created_at"));
  const tbl = table({
    rows, onRow: (u) => editUser(u), rowClass: (u) => (u.is_active ? "" : "is-muted"),
    columns: [
      { label: "Name", render: (u) => h("div", {}, h("strong", {}, fullName(u)), h("small", {}, "@" + u.username)) },
      { label: "Role", render: (u) => badge(u.role) },
      { label: "Last sign-in", render: (u) => (u.last_login_at ? relative(u.last_login_at) : h("span", { class: "muted" }, "never")) },
      { label: "Status", render: (u) => h("div", {}, badge(u.is_active ? "active" : "inactive"), u.must_change_password ? h("small", {}, "must set password") : null) },
    ] });

  function newUser() {
    const f = form([
      { name: "firstName", label: "First name", required: true },
      { name: "lastName", label: "Last name", required: true },
      { name: "username", label: "Username", required: true, hint: "Lower case, 3–40 characters (a-z, 0-9, . _ -)", validate: (v) => (/^[a-z0-9._-]{3,40}$/.test(v.toLowerCase()) ? "" : "Only a-z, 0-9, . _ -") },
      { name: "role", label: "Role", type: "select", options: Object.keys(ROLE_INFO).map((r) => [r, `${label(r)} – ${ROLE_INFO[r]}`]), default: "dispatcher" },
      { name: "phone", label: "Mobile", type: "tel" },
      { name: "email", label: "E-mail (optional)", type: "email" },
      { name: "password", label: "Start password", type: "password", required: true, span: 2, hint: "The person must change it at the first sign-in.", validate: (v) => passwordProblem(v) },
    ]);
    const d = openDrawer({ title: "New login", body: f.el });
    d.setFooter([btn("Cancel", { onClick: d.close }), btn("Create login", { variant: "primary", onClick: (e) => {
      if (!f.validate()) return;
      busy(e.currentTarget, async () => {
        try { const v = f.values(); await callFunction("admin-users", { action: "create", ...v, username: v.username.toLowerCase() }); toast(`Login ${v.username.toLowerCase()} created`); d.close(); document.querySelector('.settings-nav [data-id="team"]').click(); }
        catch (err) { toastError(err); }
      });
    } })]);
  }
  function editUser(u) {
    const self = u.id === me().id;
    const roleSel = h("select", { class: "input", disabled: self }, Object.keys(ROLE_INFO).map((r) => h("option", { value: r, selected: r === u.role }, `${label(r)} – ${ROLE_INFO[r]}`)));
    const d = openDrawer({ title: fullName(u), subtitle: "@" + u.username, body: h("div", {},
      dl([["Status", badge(u.is_active ? "active" : "inactive")], ["Phone", u.phone], ["E-mail", u.email], ["Last sign-in", dateTime(u.last_login_at)], ["Created", dateTime(u.created_at)]]),
      h("p", { class: "section-title" }, "Role"),
      h("div", { class: "row" }, roleSel, !self ? btn("Save role", { small: true, onClick: (e) => busy(e.currentTarget, async () => {
        try { await callFunction("admin-users", { action: "set_role", userId: u.id, role: roleSel.value }); toast("Role changed"); d.close(); document.querySelector('.settings-nav [data-id="team"]').click(); } catch (err) { toastError(err); }
      }) }) : null),
      self ? h("p", { class: "muted small", style: { marginTop: "8px" } }, "You can't change your own role.") : null) });
    const foot = [];
    if (!self) foot.push(btn(u.is_active ? "Deactivate" : "Activate", { variant: "ghost", onClick: async () => {
      if (u.is_active && !(await confirmDialog({ title: `Deactivate ${u.username}?`, message: "The person can no longer sign in. History stays.", confirmText: "Deactivate", danger: true }))) return;
      try { await callFunction("admin-users", { action: "set_active", userId: u.id, isActive: !u.is_active }); toast(u.is_active ? "Login deactivated" : "Login activated"); d.close(); document.querySelector('.settings-nav [data-id="team"]').click(); } catch (err) { toastError(err); }
    } }));
    foot.push(h("span", { class: "spacer" }), btn("Reset password", { ic: "lock", onClick: async () => {
      const pw = await confirmDialog({ title: "Set a new start password", message: `${u.username} must change it at the next sign-in.`, confirmText: "Set password", input: { label: "New password (min. 10 characters, letters and numbers)", required: true } });
      if (!pw) return;
      const problem = passwordProblem(pw, u.username); if (problem) return toastError(new Error(problem));
      try { await callFunction("admin-users", { action: "reset_password", userId: u.id, password: pw }); toast("Password reset"); } catch (err) { toastError(err); }
    } }));
    d.setFooter(foot);
  }
  return card("Team & logins", tbl, { cls: "flush", sub: "Everyone signs in with their own username.", actions: btn("New login", { small: true, variant: "primary", ic: "plus", onClick: newUser }) });
}

/* ---------------- finance settings ---------------- */
async function finance() {
  const fs = check(await sb.from("finance_settings").select("*").eq("id", 1).maybeSingle()) || {};
  const editable = ["owner", "admin"].includes(me().role);
  const f = form([
    { name: "default_vat_rate", label: "Standard VAT %", type: "number", step: "0.01", min: 0, max: 99 },
    { name: "reduced_vat_rate", label: "Reduced VAT %", type: "number", step: "0.01", min: 0, max: 99 },
    { name: "chart_of_accounts", label: "Chart of accounts", type: "select", options: [["SKR03", "SKR03"], ["SKR04", "SKR04"]] },
    { name: "fiscal_year_start_month", label: "Fiscal year starts in month", type: "number", min: 1, max: 12 },
    { name: "small_business", label: "Small business (Kleinunternehmer §19 UStG – no VAT)", type: "checkbox", span: 2 },
  ], fs);
  if (!editable) Object.values(f.inputs).forEach(({ input }) => (input.disabled = true));
  const save = btn("Save", { variant: "primary", onClick: () => busy(save, async () => {
    try { check(await sb.from("finance_settings").update(f.values()).eq("id", 1)); toast("Finance settings saved"); } catch (e) { toastError(e); }
  }) });
  const cats = check(await sb.from("finance_categories").select("*").order("kind").order("sort_order"));
  const catTable = table({ rows: cats, rowClass: (c) => (c.is_active ? "" : "is-muted"), columns: [
    { label: "Category", render: (c) => h("div", {}, h("strong", {}, c.name_en), h("small", {}, c.name_de)) },
    { label: "Type", render: (c) => badge(c.kind) },
    { label: "VAT", render: (c) => `${num(c.default_vat_rate, 0)} %` },
    { label: "SKR03", render: (c) => h("span", { class: "mono" }, c.account_skr03 || "–") },
    { label: "Active", render: (c) => {
      const cb = h("input", { type: "checkbox", checked: c.is_active, disabled: !can("finance.edit") });
      cb.addEventListener("change", async () => { try { check(await sb.from("finance_categories").update({ is_active: cb.checked }).eq("code", c.code)); invalidate("categories"); toast("Saved"); } catch (e) { toastError(e); cb.checked = !cb.checked; } });
      return h("label", { class: "switch" }, cb, h("i"));
    } },
  ] });
  return [
    card("Finance settings", h("div", {}, f.el, h("div", { class: "note gold", style: { marginTop: "14px" } }, "Please confirm VAT rates and accounts with your tax advisor."), editable ? actions(save) : null)),
    card("Categories", catTable, { cls: "flush", sub: "Switch off categories you don't use." }),
  ];
}

/* ---------------- activity log ---------------- */
async function activity() {
  const [rows, admins] = await Promise.all([
    sb.from("audit_log").select("*").order("changed_at", { ascending: false }).limit(100).then(check),
    sb.from("admin_users").select("id, username").then(check),
  ]);
  const who = (id) => admins.find((a) => a.id === id)?.username || (id ? "system" : "website / system");
  const describe = (r) => {
    const n = r.new_data || {}, o = r.old_data || {};
    const name = n.display_name || o.display_name || n.booking_reference || o.booking_reference || n.name || n.username || r.record_id;
    if (String(r.action).toUpperCase() === "UPDATE") {
      const changed = Object.keys(n).filter((k) => !["updated_at"].includes(k) && JSON.stringify(n[k]) !== JSON.stringify(o[k]));
      return `${name}: ${changed.slice(0, 5).map(label).join(", ")}${changed.length > 5 ? "…" : ""}`;
    }
    return name;
  };
  return card("Activity log", table({ rows, emptyEl: empty("No activity yet", null, null, "clock"), columns: [
    { label: "When", render: (r) => h("span", { title: dateTime(r.changed_at) }, relative(r.changed_at)) },
    { label: "Who", render: (r) => who(r.changed_by) },
    { label: "What", render: (r) => h("div", {}, h("strong", {}, `${label(r.table_name)} ${r.action.toLowerCase()}`), h("small", {}, describe(r))) },
  ] }), { cls: "flush", sub: "Last 100 changes to vehicles, drivers, bookings and settings." });
}
