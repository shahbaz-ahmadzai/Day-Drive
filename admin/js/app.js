// Admin panel shell: menu, routing, top bar.
// To add a new page: create js/pages/<name>.js (export default { title, render(root, ctx) })
// and add one line to PAGES below. Nothing else needs to change.
import { requireAdmin, signOut, me, can, changePassword, passwordProblem } from "./core/auth.js";
import { sb } from "./core/supabase.js";
import { h, icon, clear, spinner, toastError, openModal, form, btn, busy, toast } from "./core/ui.js";
import { initials, fullName, label } from "./core/format.js";
import { CONFIG } from "./config.js";

export const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", section: "Overview", load: () => import("./pages/dashboard.js") },
  { id: "inbox",     label: "Inbox",     icon: "inbox",     section: "Overview", load: () => import("./pages/inbox.js") },
  { id: "bookings",  label: "Bookings",  icon: "calendar",  section: "Operations", load: () => import("./pages/bookings.js"), badge: "bookings" },
  { id: "vehicles",  label: "Vehicles",  icon: "car",       section: "Operations", load: () => import("./pages/vehicles.js") },
  { id: "drivers",   label: "Drivers",   icon: "users",     section: "Operations", load: () => import("./pages/drivers.js") },
  { id: "finance",   label: "Finance",   icon: "chart",     section: "Finance", load: () => import("./pages/finance.js"), perm: "finance.view" },
  { id: "expense",   label: "Add expense", icon: "receipt", section: "Finance", load: () => import("./pages/expense.js"), perm: "expenses.add" },
  { id: "profile",   label: "Profile",   icon: "user",      section: "Account", load: () => import("./pages/profile.js") },
  { id: "settings",  label: "Settings",  icon: "settings",  section: "Account", load: () => import("./pages/settings.js") },
];

const $ = (s) => document.querySelector(s);
let cleanup = null, loadSeq = 0;

/* ---------- routing: #/page?key=value ---------- */
export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, qs = ""] = raw.split("?");
  return { page: path || "dashboard", params: Object.fromEntries(new URLSearchParams(qs)) };
}
export function go(page, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")).toString();
  const next = `#/${page}${qs ? "?" + qs : ""}`;
  if (location.hash === next) render(); else location.hash = next;
}
/* update the query without re-rendering (e.g. filters) */
export function setParams(params) {
  const { page } = parseHash();
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")).toString();
  history.replaceState(null, "", `#/${page}${qs ? "?" + qs : ""}`);
}

async function render() {
  const { page, params } = parseHash();
  let def = PAGES.find((p) => p.id === page && (!p.perm || can(p.perm)));
  if (!def) { go("dashboard"); return; }
  const seq = ++loadSeq;
  if (typeof cleanup === "function") { try { cleanup(); } catch (_) {} }
  cleanup = null;
  document.querySelectorAll(".nav-link").forEach((a) => a.classList.toggle("is-active", a.dataset.page === def.id));
  document.body.classList.remove("nav-open");
  $("#topTitle").textContent = def.label;
  document.title = `${def.label} · ${CONFIG.COMPANY_NAME} Admin`;
  const root = clear($("#view"));
  root.append(spinner());
  try {
    const mod = (await def.load()).default;
    if (seq !== loadSeq) return;
    clear(root);
    root.scrollTop = 0; window.scrollTo(0, 0);
    cleanup = await mod.render(root, { params, go, setParams, refreshBadges });
  } catch (e) {
    console.error(e);
    if (seq !== loadSeq) return;
    clear(root).append(h("div", { class: "card error-card" }, h("h2", {}, "This page could not be loaded"), h("p", { class: "muted" }, e.message), btn("Try again", { ic: "refresh", onClick: render })));
  }
}

/* ---------- sidebar ---------- */
function buildNav() {
  const nav = $("#nav");
  clear(nav);
  let section = null, group = null;
  for (const p of PAGES) {
    if (p.perm && !can(p.perm)) continue;
    if (p.section !== section) {
      section = p.section;
      group = h("div", { class: "nav-group" }, h("p", { class: "nav-title" }, section));
      nav.append(group);
    }
    group.append(h("a", { class: "nav-link", href: `#/${p.id}`, "data-page": p.id }, icon(p.icon, 19), h("span", {}, p.label),
      p.badge ? h("b", { class: "nav-badge", "data-badge": p.badge, hidden: true }) : null));
  }
}

/* bookings that need attention: upcoming + no driver yet */
export async function refreshBadges() {
  const { count } = await sb.from("bookings").select("id", { count: "exact", head: true })
    .in("status", ["confirmed"]).is("driver_id", null).gte("booking_start", new Date().toISOString());
  const b = document.querySelector('[data-badge="bookings"]');
  if (b) { b.hidden = !count; b.textContent = count > 99 ? "99+" : count || ""; b.title = `${count} booking(s) without a driver`; }
}

function buildUser() {
  const u = me();
  $("#userBox").replaceWith(h("div", { id: "userBox", class: "user-box" },
    h("button", { type: "button", class: "user-btn", "aria-haspopup": "menu", onClick: (e) => { e.stopPropagation(); $("#userMenu").classList.toggle("open"); } },
      h("span", { class: "avatar" }, initials(u)),
      h("span", { class: "user-meta" }, h("strong", {}, fullName(u)), h("small", {}, label(u.role))), icon("chevronRight", 15)),
    h("div", { id: "userMenu", class: "menu", role: "menu" },
      h("a", { href: "#/profile", role: "menuitem" }, icon("user", 16), "My profile"),
      h("a", { href: CONFIG.WEBSITE_URL, target: "_blank", rel: "noopener", role: "menuitem" }, icon("external", 16), "Open website"),
      h("button", { type: "button", role: "menuitem", onClick: signOut }, icon("logout", 16), "Sign out"))));
  document.addEventListener("click", () => $("#userMenu")?.classList.remove("open"));
}

/* first login: the password must be changed before anything else */
function forcePasswordChange() {
  return new Promise((resolve) => {
    const u = me();
    const f = form([
      { name: "pw1", label: "New password", type: "password", required: true, span: 2, hint: "At least 10 characters with letters and numbers.",
        validate: (v) => passwordProblem(v, u.username) },
      { name: "pw2", label: "Repeat new password", type: "password", required: true, span: 2,
        validate: (v, api) => (v !== api.inputs.pw1.input.value ? "The passwords don't match." : "") },
    ], {}, { cols: 1 });
    const m = openModal({ title: "Choose your own password", subtitle: `Welcome, ${u.first_name || u.username}. For security, please replace the start password.`, body: f.el });
    m.el.querySelector(".modal-head .btn-icon")?.remove();
    const save = btn("Save password", { variant: "primary", onClick: () => {
      if (!f.validate()) return;
      busy(save, async () => {
        try { await changePassword(f.values().pw1); toast("Password changed"); m.close(); resolve(); }
        catch (e) { toastError(e); }
      });
    } });
    m.setFooter([btn("Sign out", { onClick: signOut }), save]);
    f.el.addEventListener("submit", (e) => { e.preventDefault(); save.click(); });
  });
}

async function start() {
  const u = await requireAdmin();
  if (!u) return;
  document.body.classList.remove("booting");
  buildNav(); buildUser();
  $("#navToggle").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("#navBackdrop").addEventListener("click", () => document.body.classList.remove("nav-open"));
  $("#quickBooking").addEventListener("click", () => go("bookings", { new: "1" }));
  if (!can("bookings.edit")) $("#quickBooking").hidden = true;
  if (u.must_change_password) await forcePasswordChange();
  window.addEventListener("hashchange", render);
  render();
  refreshBadges().catch(() => {});
  setInterval(() => refreshBadges().catch(() => {}), 60000);
  // new website bookings appear without reloading
  sb.channel("bookings-live").on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, () => {
    refreshBadges().catch(() => {});
    window.dispatchEvent(new CustomEvent("dd:bookings-changed"));
  }).subscribe();
  sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") location.replace("index.html"); });
}

start().catch((e) => { console.error(e); toastError(e); });
