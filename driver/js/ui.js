// Tiny UI helpers for the driver app: elements, icons, toasts, sheets, formatting
import { t, locale } from "./i18n.js";

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
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

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  car: '<path d="M5 17h14M3 13l2-6a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 7l2 6v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h18"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 1-1h11l-2 4 2 4H5"/>',
  nav: '<path d="m3 11 19-9-9 19-2-8z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  bag: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  euro: '<path d="M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10"/>',
  receipt: '<path d="M5 2v20l2.5-1.5L10 22l2-1.5 2 1.5 2.5-1.5L19 22V2l-2.5 1.5L14 2l-2 1.5L10 2 7.5 3.5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  fuel: '<path d="M3 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M3 22h12M6 7h6"/><path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
  parking: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 17V7h4a3 3 0 0 1 0 6H9"/>',
  wash: '<path d="M7 16a4 4 0 0 1-4-4c0-3 4-8 4-8s4 5 4 8a4 4 0 0 1-4 4zM17 21a3 3 0 0 1-3-3c0-2.2 3-6 3-6s3 3.8 3 6a3 3 0 0 1-3 3z"/>',
  toll: '<path d="M4 21V9l8-6 8 6v12"/><path d="M4 13h16M9 21v-5h6v5"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  tyre: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
  tow: '<path d="M2 17h3l3-7h6l2 4h5v3h-2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M9 18h6M14 10V5l4-2"/>',
  ticket: '<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M13 5v14" stroke-dasharray="2 2"/>',
  dots: '<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>',
  bluetooth: '<path d="m7 7 10 10-5 5V2l5 5L7 17"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  play: '<circle cx="12" cy="12" r="10"/><path d="m10 8 6 4-6 4z"/>',
  stop: '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
};
export function icon(name, size = 22) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size);
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.9");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  s.classList.add("ic"); s.innerHTML = P[name] || P.dots;
  return s;
}

export function btn(text, { cls = "", ic, onClick, type = "button", disabled } = {}) {
  return h("button", { type, class: `btn ${cls}`.trim(), onClick, disabled }, ic ? icon(ic) : null, text ? h("span", {}, text) : null);
}

/* run an async action while the button shows a spinner */
export async function busy(button, fn) {
  if (button) { button.disabled = true; button.classList.add("is-busy"); }
  try { return await fn(); }
  finally { if (button) { button.disabled = false; button.classList.remove("is-busy"); } }
}

export function toast(msg, type = "ok", ms = 3500) {
  let box = document.getElementById("toasts");
  if (!box) { box = h("div", { id: "toasts", "aria-live": "polite" }); document.body.append(box); }
  const el = h("div", { class: `toast toast-${type}` }, icon(type === "error" ? "alert" : "check", 20), h("span", {}, msg));
  box.append(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, ms);
}

/* bottom sheet; resolves with whatever done(value) is called with (undefined when closed) */
export function sheet(build) {
  return new Promise((resolve) => {
    const back = h("div", { class: "sheet-back" });
    const panel = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" });
    let finished = false;
    const done = (v) => { if (finished) return; finished = true; back.classList.remove("in"); setTimeout(() => back.remove(), 220); resolve(v); };
    back.addEventListener("click", (e) => { if (e.target === back) done(undefined); });
    panel.append(h("div", { class: "sheet-grip" }));
    panel.append(build(done));
    back.append(panel);
    document.body.append(back);
    requestAnimationFrame(() => back.classList.add("in"));
  });
}
export function confirmSheet(text, yes = t("btn.yes"), danger = false) {
  return sheet((done) => h("div", { class: "sheet-body" },
    h("p", { class: "sheet-q" }, text),
    h("div", { class: "row-2" }, btn(t("btn.no"), { cls: "btn-light", onClick: () => done(false) }), btn(yes, { cls: danger ? "btn-danger" : "btn-gold", onClick: () => done(true) }))));
}

/* ---------- formatting (Berlin time, Latin digits) ---------- */
const TZ = "Europe/Berlin";
export const money = (v) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(Number(v || 0));
export const time = (iso) => new Intl.DateTimeFormat(locale(), { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
export function berlinDay(iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(iso ? new Date(iso) : new Date());
}
export function dayLabel(iso) {
  const d = berlinDay(iso), today = berlinDay();
  const tm = berlinDay(new Date(Date.now() + 86400000));
  if (d === today) return t("today");
  if (d === tm) return t("tomorrow");
  return new Intl.DateTimeFormat(locale(), { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}
export function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} ${t("min")}` : `${Math.floor(m / 60)} ${t("h")} ${String(m % 60).padStart(2, "0")} ${t("min")}`;
}
/* "12,50" / "12.50" / "1.234,50" → 12.5 */
export function parseMoney(s) {
  if (s === null || s === undefined) return NaN;
  let v = String(s).trim().replace(/[€\s]/g, "");
  if (!v) return NaN;
  if (v.includes(",") && v.includes(".")) v = v.lastIndexOf(",") > v.lastIndexOf(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(/,/g, "");
  else v = v.replace(",", ".");
  return /^\d+(\.\d{0,2})?$/.test(v) ? Number(v) : NaN;
}
export const mapsLink = (lat, lng, address) => lat && lng
  ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
  : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address || "")}&travelmode=driving`;
