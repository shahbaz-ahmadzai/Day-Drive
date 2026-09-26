// Shared code for My Day Drive, the ride page and the monthly rides form.
// Customer login lives in its own storage ("dd-customer-auth") – separate from the admin panel and the driver app.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const CONFIG = {
  SUPABASE_URL: "https://fhvfzmbopjfldugnsoju.supabase.co",
  SUPABASE_KEY: "sb_publishable_3k0F_L47Hltmk3bOq877cg_dkpMq_pK",
  GOOGLE_MAPS_API_KEY: "AIzaSyCacZqlH-aeLD4XtNYu0o3shrMEDB2SolU",
  MAP_CENTER: { lat: 50.1109, lng: 8.6821 },
  OFFICE_PHONE: "+4917643241205",
};
export const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "dd-customer-auth" },
});

export const T = (k, v) => (window.ddT ? window.ddT(k, v) : k) || k;
export const lang = () => (window.DD_LANG === "de" ? "de" : "en");
const LOC = () => (lang() === "de" ? "de-DE" : "en-GB");
const TZ = "Europe/Berlin";

export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
/* edge function call; sends the customer's login when there is one */
export async function fn(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  let res;
  try {
    res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_KEY, Authorization: `Bearer ${session?.access_token || CONFIG.SUPABASE_KEY}` },
      body: JSON.stringify(body),
    });
  } catch (_) { throw new Error(T("acc.err.generic")); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) { const e = new Error(data.error || T("acc.err.generic")); e.status = res.status; throw e; }
  return data;
}

/* ---------- elements ---------- */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === "") continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const put = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== "")); return el; };
/* icons from the site sprite (layout.js) */
export const ic = (name, cls = "") => { const s = document.createElement("span"); s.innerHTML = window.icon ? window.icon(name, cls) : ""; return s.firstChild || document.createTextNode(""); };

export async function busy(btn, fn_) {
  if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
  try { return await fn_(); } finally { if (btn) { btn.disabled = false; btn.classList.remove("is-busy"); } }
}
export function toast(msg, type = "ok", ms = 4200) {
  let box = document.getElementById("accToasts");
  if (!box) { box = h("div", { id: "accToasts", class: "acc-toasts", "aria-live": "polite" }); document.body.append(box); }
  const el = h("div", { class: `acc-toast is-${type}` }, msg);
  box.append(el);
  setTimeout(() => { el.classList.add("is-out"); setTimeout(() => el.remove(), 300); }, ms);
}
export const fail = (e) => { console.error(e); toast(e?.message || T("acc.err.generic"), "error", 7000); };

/* simple modal dialog; resolves with the value passed to done() */
export function dialog(title, build, { wide } = {}) {
  return new Promise((resolve) => {
    const d = h("dialog", { class: "acc-dialog" + (wide ? " is-wide" : "") });
    let result;
    const done = (v) => { result = v; d.close(); };
    d.addEventListener("close", () => { d.remove(); resolve(result); });
    d.addEventListener("click", (e) => { if (e.target === d) done(undefined); });
    d.append(h("div", { class: "acc-dialog-head" }, h("h2", {}, title), h("button", { type: "button", class: "svc-close", "aria-label": T("acc.close"), onClick: () => done(undefined) }, ic("close"))),
      h("div", { class: "acc-dialog-body" }, build(done)));
    document.body.append(d);
    d.showModal();
  });
}
export const ask = (text) => dialog(text, (done) => h("div", { class: "acc-ask" },
  h("button", { type: "button", class: "btn btn-outline-gold", onClick: () => done(false) }, T("acc.no")),
  h("button", { type: "button", class: "btn btn-gold", onClick: () => done(true) }, T("acc.yes"))));

/* ---------- formatting ---------- */
export const money = (v) => new Intl.NumberFormat(LOC(), { style: "currency", currency: "EUR" }).format(Number(v || 0));
export const dateTime = (iso) => new Intl.DateTimeFormat(LOC(), { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const dayDate = (iso) => new Intl.DateTimeFormat(LOC(), { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(iso));
export const time = (iso) => new Intl.DateTimeFormat(LOC(), { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
export const date = (d) => new Intl.DateTimeFormat(LOC(), { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d + "T12:00:00Z" : d));
export const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function parseMoney(s) {
  let v = String(s ?? "").trim().replace(/[€\s]/g, "");
  if (!v) return NaN;
  if (v.includes(",") && v.includes(".")) v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  else v = v.replace(",", ".");
  return /^\d+(\.\d{0,2})?$/.test(v) ? Number(v) : NaN;
}
export const statusBadge = (s) => h("span", { class: `acc-badge is-${s}` }, T("st." + s));
export function payBadge(b) {
  const k = b.payment_method === "balance" ? "balance" : b.payment_status;
  return k ? h("span", { class: `acc-badge is-pay-${k}` }, T("pay." + k)) : null;
}

/* ---------- web push for customers (site service worker sw.js) ---------- */
const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); };
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export async function enablePush() {
  if (!pushSupported()) throw new Error(T("acc.err.generic"));
  const reg = await navigator.serviceWorker.register("sw.js");
  if ((await Notification.requestPermission()) !== "granted") throw new Error(T("acc.err.generic"));
  await navigator.serviceWorker.ready;
  const key = await rpc("push_public_key");
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
  const j = sub.toJSON();
  await rpc("push_subscribe", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_audience: "customer", p_user_agent: navigator.userAgent.slice(0, 300) });
}
