// Small UI toolkit for the admin panel: elements, icons, toasts, drawers, dialogs, tables, forms
import { label as nice } from "./format.js";

/* ---------- element builder ---------- */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
/* replace an element's content, skipping null/false (plain replaceChildren would print "null") */
export function put(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false && k !== ""));
  return el;
}

/* ---------- icons (24px line icons) ---------- */
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  car: '<path d="M5 17h14M3 13l2-6a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 7l2 6v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h18"/><circle cx="7" cy="15" r=".5"/><circle cx="17" cy="15" r=".5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .5V2l-1 .5-3-2-3 2-3-2-3 2-3-2z" transform="translate(0 1) scale(1 .92)"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  sms: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14 21 3"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  euro: '<path d="M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10"/>',
  wallet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
};
export function icon(name, size = 18) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size);
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "1.8");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  s.classList.add("ic");
  s.innerHTML = P[name] || P.more;
  return s;
}

/* ---------- buttons, badges, bits ---------- */
export function btn(text, { variant = "", ic, onClick, type = "button", title, disabled, small } = {}) {
  return h("button", { type, class: `btn ${variant ? "btn-" + variant : ""} ${small ? "btn-sm" : ""}`.trim(), onClick, title, disabled },
    ic ? icon(ic, small ? 15 : 17) : null, text ? h("span", {}, text) : null);
}
export function iconBtn(ic, title, onClick, variant = "ghost") {
  return h("button", { type: "button", class: `btn btn-icon btn-${variant}`, title, "aria-label": title, onClick }, icon(ic));
}
const TONES = {
  confirmed: "blue", assigned: "violet", on_the_way: "violet", in_progress: "amber", completed: "green",
  cancelled: "grey", expired: "grey", no_show: "red", pending_payment: "amber",
  paid: "green", pending: "amber", failed: "red", refunded: "grey", partially_refunded: "grey", cash_on_ride: "blue", invoice: "blue",
  active: "green", inactive: "grey", maintenance: "amber", on_leave: "amber",
  connected: "green", configured: "blue", not_configured: "grey", error: "red",
  attached: "green", missing: "red", not_required: "grey", income: "green", expense: "red",
  owner: "gold", admin: "blue", dispatcher: "violet", accountant: "green", sent: "green", queued: "amber", delivered: "green",
};
const LABELS = { pending_payment: "Awaiting payment", cash_on_ride: "Pay on ride", on_the_way: "On the way", in_progress: "In progress", no_show: "No-show", not_configured: "Not set up" };
export function badge(value, tone) {
  if (!value) return h("span", { class: "badge badge-grey" }, "–");
  return h("span", { class: `badge badge-${tone || TONES[value] || "grey"}` }, LABELS[value] || nice(value));
}
export const statusLabel = (v) => LABELS[v] || nice(v);

export function empty(title, text, action, ic = "inbox") {
  return h("div", { class: "empty" }, h("div", { class: "empty-ic" }, icon(ic, 28)), h("h3", {}, title), text ? h("p", {}, text) : null, action || null);
}
export function spinner(text = "Loading…") { return h("div", { class: "loading" }, h("span", { class: "spin" }), text); }
export function card(title, body, { actions, cls = "", sub } = {}) {
  return h("section", { class: `card ${cls}` },
    title ? h("header", { class: "card-head" }, h("div", {}, h("h2", {}, title), sub ? h("p", { class: "muted small" }, sub) : null), actions ? h("div", { class: "card-actions" }, actions) : null) : null,
    h("div", { class: "card-body" }, body));
}
export function pageHeader(title, sub, actions) {
  return h("header", { class: "page-head" },
    h("div", {}, h("h1", {}, title), sub ? h("p", { class: "muted" }, sub) : null),
    actions ? h("div", { class: "page-actions" }, actions) : null);
}
export function dl(pairs) {
  return h("dl", { class: "dl" }, pairs.filter(Boolean).map(([k, v]) => [h("dt", {}, k), h("dd", {}, v === null || v === undefined || v === "" ? "–" : v)]));
}
export function tabs(items, onChange, active) {
  const wrap = h("div", { class: "tabs", role: "tablist" });
  items.forEach(([key, text]) => {
    const b = h("button", { type: "button", class: "tab" + (key === active ? " is-active" : ""), role: "tab", onClick: () => {
      wrap.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active")); b.classList.add("is-active"); onChange(key);
    } }, text);
    wrap.append(b);
  });
  return wrap;
}

/* ---------- toasts ---------- */
export function toast(msg, type = "ok", ms = 3800) {
  let box = document.getElementById("toasts");
  if (!box) { box = h("div", { id: "toasts", "aria-live": "polite" }); document.body.append(box); }
  const t = h("div", { class: `toast toast-${type}` }, icon(type === "error" ? "alert" : "check", 17), h("span", {}, msg));
  box.append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
}
export const toastError = (e) => toast(e?.message || String(e), "error", 6000);

/* ---------- overlays: drawer (side panel) and modal ---------- */
function overlay(kind, { title, subtitle, body, footer, wide, onClose, locked = false }) {
  const back = h("div", { class: `ov ov-${kind}` });
  const close = () => { back.classList.add("out"); document.removeEventListener("keydown", onKey); setTimeout(() => back.remove(), 200); onClose && onClose(); };
  const onKey = (e) => { if (!locked && e.key === "Escape" && back === [...document.querySelectorAll(".ov")].pop()) close(); };
  const panel = h("div", { class: `${kind} ${wide ? "is-wide" : ""}`, role: "dialog", "aria-modal": "true" },
    h("header", { class: `${kind}-head` }, h("div", {}, h("h2", {}, title || ""), subtitle ? h("p", { class: "muted small" }, subtitle) : null), locked ? null : iconBtn("x", "Close", close)),
    h("div", { class: `${kind}-body` }, body),
    footer ? h("footer", { class: `${kind}-foot` }, footer) : null);
  back.append(panel);
  back.addEventListener("mousedown", (e) => { if (!locked && e.target === back) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add("in"));
  return { el: panel, body: panel.querySelector(`.${kind}-body`), close,
    setFooter(f) { let ft = panel.querySelector(`.${kind}-foot`); if (!ft) { ft = h("footer", { class: `${kind}-foot` }); panel.append(ft); } put(ft, f); },
    setBody(b) { put(this.body, b); } };
}
export const openDrawer = (o) => overlay("drawer", o);
export const openModal = (o) => overlay("modal", o);

export function confirmDialog({ title = "Are you sure?", message = "", confirmText = "Confirm", danger = false, input = null }) {
  return new Promise((resolve) => {
    let done = false;
    const field = input ? h(input.multiline ? "textarea" : "input", { class: "input", placeholder: input.placeholder || "", rows: 3 }) : null;
    const m = openModal({
      title, body: h("div", {}, message ? h("p", { class: "confirm-text" }, message) : null,
        field ? h("label", { class: "field" }, h("span", { class: "field-label" }, input.label || ""), field) : null),
      onClose: () => { if (!done) resolve(false); },
    });
    const ok = btn(confirmText, { variant: danger ? "danger" : "primary", onClick: () => {
      if (field && input.required && !field.value.trim()) { field.classList.add("is-invalid"); field.focus(); return; }
      done = true; m.close(); resolve(field ? field.value.trim() : true);
    } });
    m.setFooter([btn("Cancel", { onClick: () => m.close() }), ok]);
    setTimeout(() => (field || ok).focus(), 50);
  });
}

/* ---------- table ---------- */
// columns: [{ key, label, render(row), cls, sort }]
export function table({ columns, rows, onRow, emptyEl, rowClass }) {
  if (!rows.length) return emptyEl || empty("Nothing here yet");
  const t = h("table", { class: "tbl" },
    h("thead", {}, h("tr", {}, columns.map((c) => h("th", { class: c.cls || "" }, c.label)))),
    h("tbody", {}, rows.map((r) => {
      const tr = h("tr", { class: (onRow ? "is-click " : "") + (rowClass ? rowClass(r) || "" : "") },
        columns.map((c) => {
          const v = c.render ? c.render(r) : r[c.key];
          return h("td", { class: c.cls || "", "data-label": c.label }, v === null || v === undefined || v === "" ? "–" : v);
        }));
      if (onRow) tr.addEventListener("click", (e) => { if (!e.target.closest("button,a,input,select")) onRow(r); });
      return tr;
    })));
  return h("div", { class: "tbl-wrap" }, t);
}

/* ---------- forms ----------
   field: { name, label, type, options:[[value,text]], required, placeholder, hint, span (1|2), min, max, step, rows, disabled }
   type: text|email|tel|number|date|datetime|time|select|textarea|checkbox|file|password|section|tags|color */
export function form(fields, values = {}, { onSubmit, submitText, cols = 2 } = {}) {
  const el = h("form", { class: `form cols-${cols}`, novalidate: true });
  const inputs = {};
  for (const f of fields) {
    if (!f) continue;
    if (f.type === "section") { el.append(h("div", { class: "form-section" }, h("h3", {}, f.label), f.hint ? h("p", { class: "muted small" }, f.hint) : null)); continue; }
    const v = values[f.name];
    let input;
    if (f.type === "select") {
      input = h("select", { class: "input", name: f.name, disabled: f.disabled },
        f.placeholder !== undefined ? h("option", { value: "" }, f.placeholder) : null,
        (f.options || []).map(([ov, ot]) => h("option", { value: ov, selected: String(v ?? f.default ?? "") === String(ov) }, ot)));
    } else if (f.type === "textarea") {
      input = h("textarea", { class: "input", name: f.name, rows: f.rows || 3, placeholder: f.placeholder, disabled: f.disabled });
      input.value = v ?? "";
    } else if (f.type === "checkbox") {
      input = h("input", { type: "checkbox", name: f.name, checked: v ?? f.default ?? false, disabled: f.disabled });
      const wrap = h("label", { class: `check ${f.span === 2 ? "span-2" : ""}` }, input, h("span", {}, f.label), f.hint ? h("small", { class: "muted" }, f.hint) : null);
      inputs[f.name] = { f, input }; el.append(wrap); continue;
    } else {
      const type = f.type === "datetime" ? "datetime-local" : f.type === "tags" ? "text" : (f.type || "text");
      input = h("input", { class: "input", type, name: f.name, placeholder: f.placeholder, min: f.min, max: f.max, step: f.step, disabled: f.disabled,
        autocomplete: f.autocomplete || (type === "password" ? "new-password" : "off"), accept: f.accept, inputmode: f.inputmode });
      if (type !== "file") input.value = f.type === "tags" ? (Array.isArray(v) ? v.join(", ") : v ?? "") : (v ?? f.default ?? "");
    }
    inputs[f.name] = { f, input };
    el.append(h("label", { class: `field ${f.span === 2 ? "span-2" : ""}` },
      h("span", { class: "field-label" }, f.label, f.required ? h("i", { class: "req" }, " *") : null),
      input, f.hint ? h("small", { class: "field-hint" }, f.hint) : null, h("small", { class: "field-error" })));
  }
  const api = {
    el, inputs,
    values() {
      const out = {};
      for (const [n, { f, input }] of Object.entries(inputs)) {
        if (f.readOnly) continue;
        let v;
        if (f.type === "checkbox") v = input.checked;
        else if (f.type === "file") v = input.files?.[0] || null;
        else if (f.type === "number") v = input.value === "" ? null : Number(input.value);
        else if (f.type === "tags") v = input.value.split(",").map((s) => s.trim()).filter(Boolean);
        else v = input.value.trim() === "" ? null : input.value.trim();
        out[n] = v;
      }
      return out;
    },
    validate() {
      let ok = true, first = null;
      for (const { f, input } of Object.values(inputs)) {
        const errEl = input.closest(".field")?.querySelector(".field-error");
        let msg = "";
        const val = f.type === "file" ? input.files?.length : input.value.trim();
        if (f.required && !val && f.type !== "checkbox") msg = "Required";
        else if (val && f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) msg = "Not a valid e-mail";
        else if (val && f.type === "number" && ((f.min !== undefined && Number(input.value) < f.min) || (f.max !== undefined && Number(input.value) > f.max))) msg = `Between ${f.min ?? "…"} and ${f.max ?? "…"}`;
        else if (f.validate) msg = f.validate(input.value.trim(), api) || "";
        input.classList.toggle("is-invalid", !!msg);
        if (errEl) errEl.textContent = msg;
        if (msg) { ok = false; first = first || input; }
      }
      if (first) first.focus();
      return ok;
    },
    set(name, value) { const i = inputs[name]?.input; if (!i) return; if (i.type === "checkbox") i.checked = !!value; else i.value = value ?? ""; },
    get(name) { return api.values()[name]; },
    on(name, ev, fn) { inputs[name]?.input.addEventListener(ev, fn); },
  };
  if (onSubmit) {
    el.addEventListener("submit", (e) => { e.preventDefault(); if (api.validate()) onSubmit(api.values(), api); });
    if (submitText) el.append(h("div", { class: "form-actions span-2" }, btn(submitText, { variant: "primary", type: "submit" })));
  }
  return api;
}

/* run an async action with a busy button */
export async function busy(button, fn) {
  if (button) { button.disabled = true; button.classList.add("is-busy"); }
  try { return await fn(); }
  finally { if (button) { button.disabled = false; button.classList.remove("is-busy"); } }
}

/* a debounced input */
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* download text as a file */
export function downloadText(name, text, type = "text/csv;charset=utf-8") {
  const a = h("a", { href: URL.createObjectURL(new Blob(["﻿" + text], { type })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export function toCSV(rows, cols) {
  const q = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => q(c.label)).join(";"), ...rows.map((r) => cols.map((c) => q(c.value(r))).join(";"))].join("\n");
}
