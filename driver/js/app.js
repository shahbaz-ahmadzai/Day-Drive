// Day Drive driver app (home-screen web app)
// Screens: login · home (start/end work) · rides · ride · chat · expense · expenses · end work · more
// Routes: #/home  #/rides  #/ride/<id>  #/chat/<id>  #/expense  #/expenses  #/end  #/more
import { sb, rpc, fn, CONFIG } from "./sb.js";
import { t, setLang, savedLang, getLang, LANGS } from "./i18n.js";
import { h, put, icon, btn, busy, toast, sheet, confirmSheet, money, time, dayLabel, duration, parseMoney, mapsLink, berlinDay } from "./ui.js";

const app = document.getElementById("app");
const S = { me: null, rides: [], vehicles: [], session: null, channel: null, chatBooking: null, onChat: null, lastRideIds: null };
setLang(savedLang());

/* ---------------- helpers ---------------- */
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isPhone = () => /Android|iPhone|iPod|Mobile|Windows Phone/i.test(navigator.userAgent) || (matchMedia("(pointer: coarse)").matches && innerWidth < 900);
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const route = () => { const [p, id] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/"); return { page: p || "home", id, qs: new URLSearchParams(location.hash.split("?")[1] || "") }; };
const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
const local = {
  get(k, d = null) { try { const v = localStorage.getItem("dd-driver-" + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem("dd-driver-" + k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem("dd-driver-" + k); } catch (_) {} },
};
const ERR_KEYS = {
  "Username or PIN is wrong.": "err.wrong",
  "No PIN has been set for you yet. Please ask the office.": "err.no_pin",
  "Your driver app access is switched off. Please ask the office.": "err.disabled",
  "Too many wrong PINs. Please wait 15 minutes or ask the office.": "err.locked",
  "Please finish your current ride first.": "end.openRide",
  "The chat for this ride is closed.": "chat.closed",
  "Please add the receipt photo or say why there is none.": "exp.needPhoto",
  "Please enter the amount.": "exp.needAmount",
  "The ride code is wrong. Please ask the passenger again.": "code.wrong",
};
/* server messages are English – show the translation when we know it */
const errText = (e) => (e?.code === "net" || /Failed to fetch|NetworkError|Load failed/i.test(e?.message || "")) ? t("err.net") : (ERR_KEYS[e?.message] ? t(ERR_KEYS[e.message]) : (e?.message || t("err.generic")));
const fail = (e) => { console.error(e); toast(errText(e), "error", 6000); };

function topbar(title, back) {
  return h("header", { class: "top" },
    back ? h("button", { class: "top-back", type: "button", "aria-label": t("btn.back"), onClick: () => (typeof back === "function" ? back() : typeof back === "string" ? go(back) : history.back()) }, icon("back", 26)) : h("img", { class: "top-logo", src: "../assets/icons/icon-192.png", alt: "" }),
    h("h1", {}, title),
    h("span", { class: "top-space" }));
}
function tabbar(active) {
  const tab = (id, ic, label, hash) => h("a", { class: "tab" + (active === id ? " is-active" : ""), href: hash }, icon(ic, 24), h("span", {}, label));
  return h("nav", { class: "tabbar" },
    tab("home", "home", t("tab.home"), "#/home"),
    tab("rides", "list", t("tab.rides"), "#/rides"),
    h("a", { class: "tab tab-plus" + (active === "expense" ? " is-active" : ""), href: "#/expense" }, h("span", { class: "plus-dot" }, icon("plus", 28)), h("span", {}, t("tab.expense"))),
    tab("more", "more", t("tab.more"), "#/more"));
}
function screen(title, body, { back, tab, page } = {}) {
  if (page && route().page !== page) return;   // the user already went somewhere else
  put(app, topbar(title, back), h("main", { class: "main" + (tab ? " has-tabs" : "") }, body), tab ? tabbar(tab) : null);
  window.scrollTo(0, 0);
}
const loading = () => h("div", { class: "loading" }, h("span", { class: "spin" }));
function statusChip(s) { return h("span", { class: `chip chip-${s}` }, t("st." + s)); }

/* ---------------- phone-only gate + install hint ---------------- */
function gate() {
  const url = location.href.split("#")[0];
  put(app, h("main", { class: "main center" },
    h("img", { class: "gate-logo", src: "../assets/icons/driver-192.png", alt: "" }),
    h("h1", { class: "big" }, t("phone.title")),
    h("p", { class: "muted" }, t("phone.text")),
    h("p", { class: "url-box" }, url),
    btn(t("phone.anyway"), { cls: "btn-light", onClick: () => { sessionStorage.setItem("dd-desktop-ok", "1"); render(); } })));
}
function installHint() {
  if (isStandalone() || !isPhone()) return null;
  const until = local.get("install-later", 0);
  if (until > Date.now()) return null;
  const box = h("div", { class: "card install" },
    h("div", { class: "row" }, icon("share", 22), h("strong", {}, t("install.title"))),
    h("p", {}, isIOS() ? t("install.ios") : t("install.android")),
    btn(t("install.later"), { cls: "btn-light btn-sm", onClick: () => { local.set("install-later", Date.now() + 3 * 86400000); box.remove(); } }));
  return box;
}

/* ---------------- login ---------------- */
function langRow(onPick) {
  return h("div", { class: "lang-row" }, LANGS.map(([code, name]) =>
    h("button", { type: "button", class: "lang-btn" + (getLang() === code ? " is-active" : ""), onClick: () => { setLang(code); onPick(code); } }, name)));
}
function loginScreen() {
  const user = h("input", { class: "input", id: "u", autocomplete: "username", autocapitalize: "none", spellcheck: "false", value: local.get("username", "") });
  const pin = h("input", { class: "input pin", id: "p", type: "password", inputmode: "numeric", pattern: "[0-9]*", maxlength: "6", autocomplete: "current-password" });
  const err = h("p", { class: "form-err", role: "alert" });
  const go_ = btn(t("login.go"), { cls: "btn-gold btn-block", type: "submit" });
  const f = h("form", { class: "login", onSubmit: (e) => {
    e.preventDefault(); err.textContent = "";
    const u = user.value.trim().toLowerCase(), p = pin.value.trim();
    if (!u || !/^\d{4,6}$/.test(p)) { err.textContent = t("err.wrong"); return; }
    busy(go_, async () => {
      try {
        const r = await fn("driver-auth", { action: "login", username: u, pin: p });
        const { data: v, error } = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: "magiclink" });
        if (error) throw error;
        S.session = v.session;
        local.set("username", u);
        pin.value = "";
        await afterLogin(true);
      } catch (e2) { err.textContent = errText(e2); pin.value = ""; pin.focus(); }
    });
  } },
    h("label", { class: "field" }, h("span", {}, t("login.user")), user),
    h("label", { class: "field" }, h("span", {}, t("login.pin")), pin),
    err, go_,
    h("p", { class: "muted small center" }, t("login.help")));
  put(app, h("main", { class: "main login-wrap" },
    langRow(() => loginScreen()),
    h("img", { class: "login-logo", src: "../assets/images/logo-light.svg", alt: "Day Drive Service" }),
    h("h1", { class: "big center" }, t("login.title")),
    installHint(), f));
  setTimeout(() => (user.value ? pin : user).focus(), 60);
}

/* ---------------- data ---------------- */
async function loadMe() {
  S.me = await rpc("driver_me");
  local.set("me", S.me);
  return S.me;
}
async function loadRides(days = 14) {
  try {
    S.rides = (await rpc("driver_my_rides", { p_days: days })) || [];
    local.set("rides", S.rides);
  } catch (e) {
    S.rides = local.get("rides", []) || [];
    if (!navigator.onLine) toast(t("offline"), "error"); else throw e;
  }
  return S.rides;
}
async function loadVehicles() {
  if (S.vehicles.length) return S.vehicles;
  const { data, error } = await sb.from("vehicles").select("id, display_name, plate_number, odometer_km, status, image_path").neq("status", "inactive").order("sort_order").order("display_name");
  if (error) throw new Error(error.message);
  return (S.vehicles = data || []);
}

async function afterLogin(fresh) {
  try {
    await loadMe();
  } catch (e) {
    if (/Not a driver login/i.test(e.message)) { await sb.auth.signOut(); loginScreen(); toast(t("err.disabled"), "error", 7000); return; }
    const cached = local.get("me"); if (!cached) { fail(e); loginScreen(); return; }
    S.me = cached;
  }
  if (fresh) rpc("driver_set_language", { p_lang: getLang() }).catch(() => {});
  else if (S.me?.driver?.language && S.me.driver.language !== getLang() && !local.get("lang-chosen")) setLang(S.me.driver.language);
  listen();
  autoPush();
  if (fresh || !location.hash) go("#/home"); else render();
}

/* live updates: new/changed rides and chat messages */
function listen() {
  if (S.channel || !S.me?.driver?.id) return;
  const id = S.me.driver.id;
  S.channel = sb.channel("driver-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `driver_id=eq.${id}` }, async (p) => {
      const known = new Set(S.rides.map((r) => r.id));
      await loadRides().catch(() => {});
      if (p.eventType === "INSERT" || (p.new?.id && !known.has(p.new.id) && S.rides.some((r) => r.id === p.new.id))) toast(t("st.confirmed") + ": " + (p.new?.pickup_address || ""), "ok", 6000);
      const r = route();
      if (["home", "rides"].includes(r.page) || (r.page === "ride" && r.id === p.new?.id)) render();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "ride_messages" }, (p) => {
      const m = p.new;
      if (S.onChat && S.chatBooking === m.booking_id) S.onChat(m);
      else if (m.sender_type !== "driver") { const r = S.rides.find((x) => x.id === m.booking_id); if (r) { r.unread_messages = (r.unread_messages || 0) + 1; toast(t("chat.customer") + ": " + m.body.slice(0, 60)); } }
    })
    .subscribe();
}

/* ---------------- push notifications ---------------- */
const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
async function subscribePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error(t("more.notifyIos"));
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(t("more.notifyBlocked"));
  const reg = await navigator.serviceWorker.ready;
  const key = await rpc("push_public_key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
  const j = sub.toJSON();
  await rpc("push_subscribe", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_audience: "driver", p_user_agent: navigator.userAgent.slice(0, 300) });
  return true;
}
function pushState() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission; // default | granted | denied
}
async function autoPush() { if (pushState() === "granted") subscribePush().catch(() => {}); }

/* ---------------- car (Bluetooth starter box) ---------------- */
async function bleSend(tok) {
  if (!tok) { toast(t("car.noDevice"), "error"); return false; }
  if (!navigator.bluetooth) { toast(t("car.notSupported"), "error", 7000); return false; }
  try {
    let device = null;
    if (navigator.bluetooth.getDevices) device = (await navigator.bluetooth.getDevices()).find((d) => d.name === tok.device_uid) || null;
    if (!device) device = await navigator.bluetooth.requestDevice({ filters: [{ name: tok.device_uid }, { services: [CONFIG.BLE_SERVICE] }], optionalServices: [CONFIG.BLE_SERVICE] });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(CONFIG.BLE_SERVICE);
    const ch = await service.getCharacteristic(CONFIG.BLE_TOKEN_CHAR);
    await ch.writeValueWithResponse(new TextEncoder().encode(tok.token));
    local.set("ble-device", device.name);
    rpc("driver_report_vehicle_event", { p_event_type: tok.action === "lock" ? "locked" : "unlocked", p_data: { device: device.name } }).catch(() => {});
    setTimeout(() => { try { device.gatt.disconnect(); } catch (_) {} }, 1500);
    toast(tok.action === "lock" ? "🔒" : t("car.connected"));
    return true;
  } catch (e) {
    console.warn("ble", e);
    rpc("driver_report_vehicle_event", { p_event_type: "ble_failed", p_data: { error: String(e?.message || e).slice(0, 200) } }).catch(() => {});
    if (e?.name !== "NotFoundError") toast(t("car.failed"), "error", 6000);
    return false;
  }
}
async function unlockCar() {
  try { await bleSend(await rpc("driver_unlock_token")); } catch (e) { fail(e); }
}

/* ---------------- HOME ---------------- */
async function homeScreen() {
  screen(t("app.name"), loading(), { tab: "home", page: "home" });
  try { await Promise.all([loadMe(), loadRides(3)]); } catch (e) { fail(e); }
  const me = S.me || {}; const shift = me.shift;
  const next = S.rides.slice(0, 4);
  const body = [
    h("p", { class: "hello" }, t("hello", { name: me.driver?.first_name || "" })),
    installHint(),
    pushState() === "default" ? h("button", { class: "card notice", type: "button", onClick: async (e) => { try { await busy(e.currentTarget, subscribePush); toast(t("more.notifyOk")); homeScreen(); } catch (err) { fail(err); } } },
      icon("bell", 24), h("span", {}, t("more.notifyOn"))) : null,
    shift ? shiftOpenCard(shift) : await shiftStartCard(me),
    h("h2", { class: "section" }, t("rides.today")),
    next.length ? next.map(rideCard) : h("div", { class: "card empty" }, icon("calendar", 30), h("p", {}, t("rides.none"))),
    S.rides.length > next.length ? btn(t("rides.all"), { cls: "btn-light btn-block", onClick: () => go("#/rides") }) : null,
  ];
  screen(t("app.name"), body, { tab: "home", page: "home" });
}

function shiftOpenCard(s) {
  return h("section", { class: "card shift is-open" },
    h("div", { class: "shift-head" }, h("span", { class: "live-dot" }), h("strong", {}, t("shift.open", { time: time(s.started_at) }))),
    h("div", { class: "shift-grid" },
      h("div", {}, h("small", {}, t("shift.car")), h("b", {}, s.vehicle_name || "–"), h("small", {}, s.plate || "")),
      h("div", {}, h("small", {}, t("shift.kmStart")), h("b", {}, s.start_odometer_km != null ? `${s.start_odometer_km} km` : "–"), h("small", {}, duration(Date.now() - new Date(s.started_at))))),
    h("div", { class: "row-2" },
      btn(t("car.connect"), { cls: "btn-light", ic: "unlock", onClick: (e) => busy(e.currentTarget, unlockCar) }),
      btn(t("tab.expense"), { cls: "btn-light", ic: "receipt", onClick: () => go("#/expense") })),
    btn(t("shift.end"), { cls: "btn-dark btn-block", ic: "stop", onClick: () => go("#/end") }));
}

async function shiftStartCard(me) {
  let vehicles = [];
  try { vehicles = await loadVehicles(); } catch (e) { fail(e); }
  let chosen = local.get("last-vehicle") || me.default_vehicle || vehicles[0]?.id || null;
  if (!vehicles.some((v) => v.id === chosen)) chosen = vehicles[0]?.id || null;
  const km = h("input", { class: "input big-input", type: "number", inputmode: "numeric", min: "0", placeholder: "123456" });
  const setKm = () => { const v = vehicles.find((x) => x.id === chosen); km.placeholder = v?.odometer_km ? String(v.odometer_km) : "123456"; };
  const list = h("div", { class: "car-list" });
  const drawCars = () => put(list, vehicles.map((v) => h("button", { type: "button", class: "car-pick" + (v.id === chosen ? " is-active" : ""), onClick: () => { chosen = v.id; drawCars(); setKm(); } },
    icon("car", 26), h("span", {}, h("b", {}, v.display_name), h("small", {}, v.plate_number || "")), v.id === chosen ? icon("check", 22) : null)));
  drawCars(); setKm();
  const start = btn(t("shift.start"), { cls: "btn-gold btn-block btn-xl", ic: "play", onClick: () => busy(start, async () => {
    try {
      if (!chosen) return;
      const odo = km.value === "" ? null : Math.round(Number(km.value));
      const v = vehicles.find((x) => x.id === chosen);
      if (odo !== null && v?.odometer_km && odo < v.odometer_km - 5) { if (!(await confirmSheet(`${odo} km < ${v.odometer_km} km ?`, t("btn.ok")))) return; }
      const pos = await position();
      const r = await rpc("driver_start_shift", { p_vehicle_id: chosen, p_odometer_km: odo, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null });
      local.set("last-vehicle", chosen);
      toast(t("shift.started"));
      if (r?.unlock && navigator.bluetooth) bleSend(r.unlock);
      homeScreen();
    } catch (e) { fail(e); }
  }) });
  return h("section", { class: "card shift" },
    h("h2", {}, t("shift.none")),
    h("p", { class: "label" }, t("shift.choose")), list,
    h("label", { class: "field" }, h("span", {}, t("shift.km")), km),
    start);
}
function position() {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    const timer = setTimeout(() => res(null), 2500);
    navigator.geolocation.getCurrentPosition((p) => { clearTimeout(timer); res({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }); },
      () => { clearTimeout(timer); res(null); }, { maximumAge: 300000, timeout: 2400 });
  });
}

function rideCard(r) {
  return h("a", { class: "card ride-card", href: `#/ride/${r.id}` },
    h("div", { class: "ride-when" }, h("b", {}, time(r.start)), h("small", {}, dayLabel(r.start))),
    h("div", { class: "ride-what" },
      h("div", { class: "row" }, statusChip(r.status), r.contract_id ? h("span", { class: "chip chip-soft" }, t("ride.monthly")) : null,
        r.unread_messages ? h("span", { class: "chip chip-red" }, icon("chat", 14), String(r.unread_messages)) : null),
      h("p", { class: "addr" }, icon("pin", 16), r.pickup),
      h("p", { class: "addr muted" }, icon("flag", 16), r.destination)),
    icon("back", 20));
}

/* ---------------- RIDES ---------------- */
async function ridesScreen() {
  screen(t("tab.rides"), loading(), { tab: "rides", page: "rides" });
  try { await loadRides(14); } catch (e) { fail(e); }
  if (!S.rides.length) { screen(t("tab.rides"), h("div", { class: "card empty" }, icon("calendar", 30), h("p", {}, t("rides.none"))), { tab: "rides", page: "rides" }); return; }
  const groups = [];
  for (const r of S.rides) {
    const d = berlinDay(r.start);
    let g = groups.find((x) => x.d === d);
    if (!g) groups.push((g = { d, label: dayLabel(r.start), rides: [] }));
    g.rides.push(r);
  }
  screen(t("tab.rides"), groups.map((g) => [h("h2", { class: "section" }, g.label), g.rides.map(rideCard)]), { tab: "rides", page: "rides" });
}

/* ---------------- RIDE ---------------- */
async function rideScreen(id) {
  let r = S.rides.find((x) => x.id === id);
  if (!r) { screen(t("ride.title"), loading(), { back: "#/rides", page: "ride" }); try { await loadRides(31); } catch (e) { fail(e); } r = S.rides.find((x) => x.id === id); }
  if (!r) { screen(t("ride.title"), h("div", { class: "card empty" }, icon("alert", 30), h("p", {}, t("st.completed") + " / " + t("st.cancelled"))), { back: "#/rides", page: "ride" }); return; }
  const stops = Array.isArray(r.stops) ? r.stops : [];
  const place = (ic, label, addr, lat, lng) => h("div", { class: "place" },
    h("span", { class: "place-ic" }, icon(ic, 20)),
    h("div", { class: "place-txt" }, h("small", {}, label), h("p", {}, addr)),
    h("a", { class: "btn btn-light btn-sm", href: mapsLink(lat, lng, addr), target: "_blank", rel: "noopener" }, icon("nav", 18), h("span", {}, t("ride.navigate"))));
  const facts = [
    [icon("users", 18), `${t("ride.passengers")}: ${r.passengers || 1}`],
    r.luggage ? [icon("bag", 18), `${t("ride.luggage")}: ${r.luggage}`] : null,
    r.flight ? [icon("plane", 18), `${t("ride.flight")}: ${r.flight}`] : null,
  ].filter(Boolean);
  const body = [
    h("section", { class: "card ride-top" },
      h("div", { class: "row between" }, h("div", {}, h("p", { class: "big-time" }, time(r.start)), h("small", {}, dayLabel(r.start), " · ", r.reference)), statusChip(r.status)),
      r.contract_id ? h("span", { class: "chip chip-soft" }, t("ride.monthly")) : null),
    h("section", { class: "card places" },
      place("pin", t("ride.pickup"), r.pickup, r.pickup_lat, r.pickup_lng),
      stops.map((s) => place("dots", t("ride.stop"), s.address, s.lat, s.lng)),
      place("flag", t("ride.destination"), r.destination, r.destination_lat, r.destination_lng)),
    h("section", { class: "card" },
      h("div", { class: "row between" }, h("div", {}, h("strong", {}, r.customer_name || "–")),
        h("div", { class: "row" },
          r.customer_phone ? h("a", { class: "btn btn-light btn-sm", href: `tel:${String(r.customer_phone).replace(/[^\d+]/g, "")}` }, icon("phone", 18), h("span", {}, t("ride.call"))) : null,
          h("a", { class: "btn btn-light btn-sm", href: `#/chat/${r.id}` }, icon("chat", 18), h("span", {}, t("ride.chat")), r.unread_messages ? h("i", { class: "dot-count" }, String(r.unread_messages)) : null))),
      h("ul", { class: "facts" }, facts.map(([i, x]) => h("li", {}, i, x))),
      r.customer_notes ? h("div", { class: "note" }, h("small", {}, t("ride.notes")), h("p", {}, r.customer_notes)) : null),
    h("section", { class: "card pay " + (r.collect ? "is-collect" : "is-paid") }, icon(r.collect ? "euro" : "check", 24),
      h("strong", {}, r.collect ? t("ride.collect", { amount: money(r.price) }) : t("ride.noCollect"))),
    actions(r),
  ];
  screen(t("ride.title"), body, { back: "#/rides", page: "ride" });
}

function actions(r) {
  const act = async (el, action, extra = {}) => busy(el, async () => {
    try {
      await rpc("driver_ride_action", { p_booking_id: r.id, p_action: action, ...extra });
      await loadRides().catch(() => {});
      if (action === "complete" || action === "no_show" || action === "release") { toast("✓"); go("#/home"); } else rideScreen(r.id);
    } catch (e) { fail(e); }
  });
  const main = (key, ic, onClick) => btn(t(key), { cls: "btn-gold btn-block btn-xl", ic, onClick });
  const out = [];
  if (r.status === "confirmed") out.push(main("act.accept", "check", (e) => act(e.currentTarget, "accept")));
  if (r.status === "confirmed" || r.status === "assigned") out.push((r.status === "assigned" ? main : (k, i, f) => btn(t(k), { cls: "btn-light btn-block", ic: i, onClick: f }))("act.on_the_way", "nav", (e) => act(e.currentTarget, "on_the_way")));
  if (r.status === "on_the_way" && !r.arrived_at) out.push(main("act.arrived", "pin", (e) => act(e.currentTarget, "arrived")));
  if (r.status === "on_the_way" && r.arrived_at) out.push(main("act.picked_up", "users", async (e) => {
    const code = await codeSheet();
    if (code === undefined) return;
    act(e.currentTarget, "picked_up", { p_code: code || null });
  }));
  if (r.status === "in_progress") out.push(main("act.complete", "flag", async (e) => {
    if (!r.collect) return act(e.currentTarget, "complete");
    const p = await paySheet(r);
    if (!p) return;
    act(e.currentTarget, "complete", { p_collected_method: p.method, p_collected_amount: p.amount });
  }));
  if (r.status === "on_the_way" && r.arrived_at) out.push(btn(t("act.no_show"), { cls: "btn-light btn-block", ic: "x", onClick: async (e) => { if (await confirmSheet(t("act.noShowAsk"), t("btn.yes"), true)) act(e.currentTarget, "no_show"); } }));
  if (r.status === "confirmed" || r.status === "assigned") out.push(btn(t("act.release"), { cls: "btn-text", onClick: async (e) => { if (await confirmSheet(t("act.releaseAsk"), t("btn.yes"), true)) act(e.currentTarget, "release"); } }));
  return h("div", { class: "actions" }, out);
}

/* 4-digit code keypad; resolves "1234", "" (no code) or undefined (closed) */
function codeSheet() {
  return sheet((done) => {
    let code = "";
    const boxes = h("div", { class: "code-boxes" });
    const draw = () => put(boxes, [0, 1, 2, 3].map((i) => h("span", { class: "code-box" + (code[i] ? " is-full" : "") }, code[i] || "")));
    const key = (k) => h("button", { type: "button", class: "key", onClick: () => {
      if (k === "del") code = code.slice(0, -1); else if (code.length < 4) code += k;
      draw(); if (code.length === 4) setTimeout(() => done(code), 180);
    } }, k === "del" ? "⌫" : k);
    draw();
    return h("div", { class: "sheet-body" },
      h("h3", {}, t("code.title")), h("p", { class: "muted" }, t("code.text")), boxes,
      h("div", { class: "keypad", dir: "ltr" }, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k) => (k ? key(k) : h("span")))),
      btn(t("code.skip"), { cls: "btn-text", onClick: () => done("") }));
  });
}
function paySheet(r) {
  return sheet((done) => {
    let method = null;
    const amount = h("input", { class: "input big-input", inputmode: "decimal", value: String(Number(r.price || 0).toFixed(2)).replace(".", ",") });
    const opts = h("div", { class: "pay-opts" });
    const draw = () => put(opts, [["cash", "euro", "pay.cash"], ["card", "receipt", "pay.card"], ["none", "x", "pay.none"]].map(([m, i, k]) =>
      h("button", { type: "button", class: "pay-opt" + (method === m ? " is-active" : ""), onClick: () => { method = m; draw(); amountField.hidden = m === "none"; } }, icon(i, 26), h("span", {}, t(k)))));
    const amountField = h("label", { class: "field", hidden: true }, h("span", {}, t("pay.amount")), amount);
    draw();
    return h("div", { class: "sheet-body" }, h("h3", {}, t("pay.title")), opts, amountField,
      btn(t("pay.done"), { cls: "btn-gold btn-block", onClick: () => {
        if (!method) return;
        const a = parseMoney(amount.value);
        if (method !== "none" && !(a >= 0)) { amount.classList.add("is-invalid"); return; }
        done({ method, amount: method === "none" ? 0 : a });
      } }));
  });
}

/* ---------------- CHAT ---------------- */
async function chatScreen(id) {
  const list = h("div", { class: "chat-list" });
  const input = h("textarea", { class: "input chat-input", rows: 1, placeholder: t("chat.ph"), maxlength: "1000" });
  const send = h("button", { class: "btn btn-gold chat-send", type: "submit", "aria-label": t("chat.send") }, icon("send", 22));
  const bar = h("form", { class: "chat-bar", onSubmit: async (e) => {
    e.preventDefault();
    const body = input.value.trim(); if (!body) return;
    busy(send, async () => { try { const m = await rpc("send_ride_message", { p_booking_id: id, p_body: body }); input.value = ""; add(m); } catch (err) { fail(err); } });
  } }, input, send);
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; });
  const seen = new Set();
  const add = (m) => {
    if (!m || seen.has(m.id)) return; seen.add(m.id);
    list.querySelector(".chat-empty")?.remove();
    const mine = m.sender_type === "driver";
    list.append(h("div", { class: "msg " + (mine ? "is-mine" : m.sender_type === "office" ? "is-office" : "") },
      h("small", {}, mine ? t("chat.you") : t("chat." + (m.sender_type === "office" ? "office" : "customer")), " · ", time(m.created_at)),
      h("p", {}, m.body)));
    requestAnimationFrame(() => list.lastElementChild?.scrollIntoView({ block: "end" }));
  };
  put(app, topbar(t("chat.title"), `#/ride/${id}`), h("main", { class: "main chat" }, list), bar);
  list.append(loading());
  const { data, error } = await sb.from("ride_messages").select("id, sender_type, body, created_at").eq("booking_id", id).order("created_at");
  put(list);
  if (error) fail(new Error(error.message));
  if (!data?.length) list.append(h("p", { class: "chat-empty muted center" }, t("chat.empty")));
  (data || []).forEach(add);
  S.chatBooking = id; S.onChat = (m) => { add(m); if (m.sender_type !== "driver") rpc("mark_ride_messages_read", { p_booking_id: id }).catch(() => {}); };
  rpc("mark_ride_messages_read", { p_booking_id: id }).catch(() => {});
  const r = S.rides.find((x) => x.id === id); if (r) r.unread_messages = 0;
}

/* ---------------- EXPENSE ---------------- */
const CATS = [
  ["fuel", "fuel"], ["parking", "parking"], ["car_wash", "wash"], ["tolls", "toll"], ["service", "wrench"],
  ["parts", "tyre"], ["repair_other", "tow"], ["fines", "ticket"], ["company_other", "dots"],
];
/* shrink the photo so it uploads quickly on mobile data */
async function shrink(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), "image/jpeg", 0.8));
  } catch (_) { return file; }
}
function expenseScreen(qs) {
  const backTo = qs.get("back") === "end" ? "#/end" : null;
  const st = { cat: null, photo: null, noReceipt: false, method: "card" };
  const grid = h("div", { class: "cat-grid" });
  const drawCats = () => put(grid, CATS.map(([code, ic]) => h("button", { type: "button", class: "cat" + (st.cat === code ? " is-active" : ""), onClick: () => { st.cat = code; drawCats(); fuelBox.hidden = code !== "fuel"; amount.focus(); } }, icon(ic, 30), h("span", {}, t("cat." + code)))));
  const amount = h("input", { class: "input big-input", inputmode: "decimal", placeholder: "0,00" });
  const file = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true });
  const preview = h("div", { class: "photo-prev" });
  const photoBtn = btn(t("exp.photo"), { cls: "btn-dark btn-block btn-xl", ic: "camera", onClick: () => file.click() });
  file.addEventListener("change", async () => {
    const f = file.files?.[0]; if (!f) return;
    st.photo = await shrink(f); st.noReceipt = false; reasonBox.hidden = true;
    put(preview, h("img", { src: URL.createObjectURL(st.photo), alt: "" }));
    photoBtn.querySelector("span").textContent = t("exp.photoAgain");
  });
  const reason = h("input", { class: "input" });
  const reasonBox = h("label", { class: "field", hidden: true }, h("span", {}, t("exp.reason")), reason);
  const noRec = btn(t("exp.noReceipt"), { cls: "btn-text", onClick: () => { st.noReceipt = true; st.photo = null; put(preview); reasonBox.hidden = false; reason.focus(); } });
  const methods = h("div", { class: "seg" });
  const drawMethods = () => put(methods, [["card", "pay.card"], ["cash", "pay.cash"], ["fuel_card", "exp.fuelCard"]].map(([m, k]) =>
    h("button", { type: "button", class: "seg-btn" + (st.method === m ? " is-active" : ""), onClick: () => { st.method = m; drawMethods(); } }, t(k))));
  const liters = h("input", { class: "input", inputmode: "decimal" });
  const km = h("input", { class: "input", type: "number", inputmode: "numeric" });
  const fuelBox = h("div", { class: "grid-2", hidden: true }, h("label", { class: "field" }, h("span", {}, t("exp.liters")), liters), h("label", { class: "field" }, h("span", {}, t("exp.km")), km));
  const note = h("input", { class: "input" });
  drawCats(); drawMethods();
  const save = btn(t("exp.save"), { cls: "btn-gold btn-block btn-xl", ic: "check", onClick: () => busy(save, async () => {
    try {
      if (!st.cat) { grid.classList.add("shake"); setTimeout(() => grid.classList.remove("shake"), 500); return; }
      const a = parseMoney(amount.value);
      if (!(a > 0)) { toast(t("exp.needAmount"), "error"); amount.focus(); return; }
      if (!st.photo && !(st.noReceipt && reason.value.trim())) { toast(t("exp.needPhoto"), "error"); return; }
      let path = null;
      if (st.photo) {
        const id = S.me?.driver?.id || (await loadMe()).driver.id;
        path = `drivers/${id}/${berlinDay()}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.jpg`;
        const { error } = await sb.storage.from("receipts").upload(path, st.photo, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error(error.message);
      }
      const lit = parseMoney(liters.value);
      await rpc("driver_add_expense", {
        p_category: st.cat, p_amount: a, p_receipt_path: path, p_note: note.value.trim() || null, p_vendor: null,
        p_payment_method: st.method, p_fuel_liters: st.cat === "fuel" && lit > 0 ? lit : null,
        p_odometer_km: st.cat === "fuel" && km.value ? Math.round(Number(km.value)) : null,
        p_no_receipt_reason: st.photo ? null : reason.value.trim(), p_vat_rate: null,
      });
      toast(t("exp.saved"));
      go(backTo || "#/home");
    } catch (e) { fail(e); }
  }) });
  screen(t("exp.title"), [
    h("p", { class: "label" }, t("exp.what")), grid,
    h("label", { class: "field" }, h("span", {}, t("exp.amount")), amount),
    photoBtn, file, preview, noRec, reasonBox,
    h("p", { class: "label" }, t("exp.paidWith")), methods,
    fuelBox,
    h("label", { class: "field" }, h("span", {}, t("exp.note")), note),
    save,
    h("a", { class: "btn btn-text btn-block", href: "#/expenses" }, t("exp.list")),
  ], backTo ? { back: backTo } : { tab: "expense" });
}

async function expensesScreen() {
  screen(t("exp.list"), loading(), { back: "#/more" });
  let rows = [];
  try { rows = (await rpc("driver_my_expenses", { p_days: 14 })) || []; } catch (e) { fail(e); }
  screen(t("exp.list"), rows.length ? rows.map(expenseRow) : h("div", { class: "card empty" }, icon("receipt", 30), h("p", {}, t("exp.none"))), { back: "#/more", page: "expenses" });
}
function expenseRow(x) {
  const ic = CATS.find((c) => c[0] === x.category)?.[1] || "receipt";
  return h("div", { class: "card exp-row" }, h("span", { class: "exp-ic" }, icon(ic, 22)),
    h("div", {}, h("b", {}, t("cat." + x.category) !== "cat." + x.category ? t("cat." + x.category) : x.category_name), h("small", {}, dayLabel(x.created_at), " · ", time(x.created_at),
      x.receipt === "missing" ? h("span", { class: "chip chip-red" }, t("exp.missing")) : null)),
    h("strong", {}, money(x.amount)));
}

/* ---------------- END WORK ---------------- */
function endScreen() {
  const shift = S.me?.shift;
  if (!shift) { go("#/home"); return; }
  const saved = JSON.parse(sessionStorage.getItem("dd-end") || "{}");
  const st = Object.assign({ step: 0, uber: "", bolt: "", other: "", cash: "", card: "", km: "", note: "", more: false }, saved);
  const keep = () => sessionStorage.setItem("dd-end", JSON.stringify(st));
  const steps = ["uber", "bolt", "km", "expenses", "check"];
  const moneyInput = (key) => { const i = h("input", { class: "input big-input", inputmode: "decimal", placeholder: "0,00", value: st[key] }); i.addEventListener("input", () => { st[key] = i.value; keep(); }); return i; };
  const val = (k) => { const n = parseMoney(st[k]); return n > 0 ? n : 0; };
  const bad = (k) => st[k] !== "" && !(parseMoney(st[k]) >= 0);
  const nextBtn = (onNext) => btn(t("btn.next"), { cls: "btn-gold btn-block btn-xl", onClick: onNext });
  const progress = () => h("div", { class: "steps" }, steps.map((s, i) => h("span", { class: i <= st.step ? "is-done" : "" })));

  async function draw() {
    keep();
    let body;
    const step = steps[st.step];
    const next = () => { st.step++; draw(); };
    if (step === "uber") {
      const i = moneyInput("uber");
      body = [h("p", { class: "muted" }, t("end.intro")), h("div", { class: "brand-line uber" }, "Uber"), h("h2", { class: "q" }, t("end.uber")), i,
        nextBtn(() => { if (bad("uber")) { i.classList.add("is-invalid"); return; } next(); })];
      setTimeout(() => i.focus(), 60);
    } else if (step === "bolt") {
      const i = moneyInput("bolt");
      const more = h("div", { class: "more-box", hidden: !st.more },
        h("label", { class: "field" }, h("span", {}, t("end.other")), moneyInput("other")),
        h("label", { class: "field" }, h("span", {}, t("end.cash")), moneyInput("cash")),
        h("label", { class: "field" }, h("span", {}, t("end.card")), moneyInput("card")));
      body = [h("div", { class: "brand-line bolt" }, "Bolt"), h("h2", { class: "q" }, t("end.bolt")), i,
        btn(t("end.more"), { cls: "btn-text", onClick: () => { st.more = !st.more; more.hidden = !st.more; keep(); } }), more,
        nextBtn(() => { if (["bolt", "other", "cash", "card"].some(bad)) { toast(t("exp.needAmount"), "error"); return; } next(); })];
      setTimeout(() => i.focus(), 60);
    } else if (step === "km") {
      const i = h("input", { class: "input big-input", type: "number", inputmode: "numeric", value: st.km, placeholder: shift.start_odometer_km != null ? String(shift.start_odometer_km) : "" });
      i.addEventListener("input", () => { st.km = i.value; keep(); });
      body = [h("h2", { class: "q" }, t("end.km")), i,
        shift.start_odometer_km != null ? h("p", { class: "muted" }, `${t("shift.kmStart")}: ${shift.start_odometer_km} km`) : null,
        nextBtn(() => {
          if (st.km !== "" && shift.start_odometer_km != null && Number(st.km) < shift.start_odometer_km) { i.classList.add("is-invalid"); toast(`≥ ${shift.start_odometer_km} km`, "error"); return; }
          next();
        })];
      setTimeout(() => i.focus(), 60);
    } else if (step === "expenses") {
      body = [h("h2", { class: "q" }, t("end.expenses")), loading()];
      put(main, progress(), body);
      let rows = [];
      try { rows = ((await rpc("driver_my_expenses", { p_days: 2 })) || []).filter((x) => x.shift_id === shift.id); } catch (e) { fail(e); }
      body = [h("h2", { class: "q" }, t("end.expenses")),
        rows.length ? rows.map(expenseRow) : h("p", { class: "muted" }, t("end.noExpenses")),
        btn(t("end.addExpense"), { cls: "btn-light btn-block", ic: "plus", onClick: () => go("#/expense?back=end") }),
        nextBtn(next)];
    } else {
      const note = h("textarea", { class: "input", rows: 2 }); note.value = st.note;
      note.addEventListener("input", () => { st.note = note.value; keep(); });
      const line = (k, v) => h("li", {}, h("span", {}, k), h("b", {}, v));
      const confirm = btn(t("end.confirm"), { cls: "btn-dark btn-block btn-xl", ic: "stop", onClick: () => busy(confirm, async () => {
        try {
          const pos = await position();
          const r = await rpc("driver_end_shift", { p_uber: val("uber"), p_bolt: val("bolt"), p_other_platform: val("other"), p_cash: val("cash"), p_card: val("card"),
            p_odometer_km: st.km === "" ? null : Math.round(Number(st.km)), p_note: st.note.trim() || null, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null });
          sessionStorage.removeItem("dd-end");
          if (r?.lock && navigator.bluetooth) bleSend(r.lock);
          doneScreen(r?.summary || {});
        } catch (e) { fail(e); }
      }) });
      body = [h("h2", { class: "q" }, t("end.check")),
        h("ul", { class: "sum" },
          line("Uber", money(val("uber"))), line("Bolt", money(val("bolt"))),
          val("other") ? line(t("end.other"), money(val("other"))) : null,
          val("cash") ? line(t("end.cash"), money(val("cash"))) : null,
          val("card") ? line(t("end.card"), money(val("card"))) : null,
          line(t("end.km"), st.km ? `${st.km} km` : "–")),
        h("label", { class: "field" }, h("span", {}, t("end.note")), note),
        confirm];
    }
    put(main, progress(), body);
  }
  const main = h("div", { class: "end" });
  screen(t("end.title"), main, { back: () => { if (st.step > 0) { st.step--; draw(); } else { go("#/home"); } } });
  draw();
}
function doneScreen(s) {
  const line = (k, v) => h("li", {}, h("span", {}, k), h("b", {}, v));
  put(app, h("main", { class: "main center done" },
    h("div", { class: "done-ic" }, icon("check", 44)),
    h("h1", { class: "big" }, t("end.done")),
    h("ul", { class: "sum" },
      line(t("sum.km"), s.km != null ? `${s.km} km` : "–"),
      line(t("sum.time"), s.minutes != null ? duration(s.minutes * 60000) : "–"),
      line(t("sum.platform"), money(s.platform_earnings)),
      line(t("sum.dayDrive"), `${s.day_drive_rides || 0} · ${money(s.day_drive_collected)}`),
      line(t("sum.expenses"), `${s.expense_count || 0} · ${money(s.expenses)}`),
      s.missing_receipts ? line(t("sum.missing"), String(s.missing_receipts)) : null),
    btn(t("end.logout"), { cls: "btn-gold btn-block btn-xl", ic: "logout", onClick: logout })));
}

/* ---------------- MORE ---------------- */
function moreScreen() {
  const ps = pushState();
  const notify = ps === "granted" ? h("p", { class: "ok-line" }, icon("check", 18), t("more.notifyOk"))
    : ps === "denied" ? h("p", { class: "muted" }, t("more.notifyBlocked"))
    : ps === "unsupported" ? h("p", { class: "muted" }, t("more.notifyIos"))
    : btn(t("more.notifyOn"), { cls: "btn-light btn-block", ic: "bell", onClick: async (e) => { try { await busy(e.currentTarget, subscribePush); toast(t("more.notifyOk")); moreScreen(); } catch (err) { fail(err); } } });
  screen(t("more.title"), [
    h("section", { class: "card" }, h("h3", {}, icon("globe", 20), t("more.language")),
      langRow((code) => { local.set("lang-chosen", true); rpc("driver_set_language", { p_lang: code }).catch(() => {}); moreScreen(); })),
    h("section", { class: "card" }, h("h3", {}, icon("bell", 20), t("more.notify")), notify, isIOS() && !isStandalone() ? h("p", { class: "muted small" }, t("more.notifyIos")) : null),
    h("section", { class: "card" }, h("h3", {}, icon("bluetooth", 20), t("shift.car")),
      navigator.bluetooth ? btn(t("car.connect"), { cls: "btn-light btn-block", ic: "unlock", onClick: (e) => busy(e.currentTarget, unlockCar) }) : h("p", { class: "muted" }, t("car.notSupported"))),
    h("a", { class: "card link-row", href: "#/expenses" }, icon("receipt", 22), h("span", {}, t("exp.list")), icon("back", 18)),
    h("a", { class: "card link-row", href: `tel:${CONFIG.OFFICE_PHONE}` }, icon("phone", 22), h("span", {}, t("more.office")), icon("back", 18)),
    btn(t("more.logout"), { cls: "btn-light btn-block", ic: "logout", onClick: async () => {
      if (S.me?.shift) { toast(t("more.logoutShift"), "error", 6000); go("#/end"); return; }
      logout();
    } }),
    h("p", { class: "muted small center" }, `${t("more.version")} ${CONFIG.VERSION}${S.me?.driver ? " · " + S.me.driver.name + " · " + (S.me.driver.employee_number || "") : ""}`),
  ], { tab: "more" });
}

async function logout() {
  try { if (S.channel) await sb.removeChannel(S.channel); } catch (_) {}
  S.channel = null; S.me = null; S.rides = []; S.vehicles = [];
  local.del("me"); local.del("rides");
  await sb.auth.signOut().catch(() => {});
  history.replaceState(null, "", location.pathname);
  loginScreen();
}

/* ---------------- router ---------------- */
async function render() {
  S.onChat = null; S.chatBooking = null;
  if (!isPhone() && !isStandalone() && !sessionStorage.getItem("dd-desktop-ok")) return gate();
  if (!S.session) return loginScreen();
  if (!S.me) { screen(t("app.name"), loading()); await afterLogin(false); return; }
  const r = route();
  switch (r.page) {
    case "rides": return ridesScreen();
    case "ride": return rideScreen(r.id);
    case "chat": return chatScreen(r.id);
    case "expense": return expenseScreen(r.qs);
    case "expenses": return expensesScreen();
    case "end": return endScreen();
    case "more": return moreScreen();
    default: return homeScreen();
  }
}

window.addEventListener("hashchange", render);
window.addEventListener("online", () => toast("✓ Online"));
sb.auth.onAuthStateChange((_e, session) => { S.session = session; });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw", e));
// a tap on a notification while the app is open
navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.hash) go(e.data.hash); });

(async () => {
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  render();
})();
