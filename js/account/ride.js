// Ride page (ride.html?b=<booking id>&t=<link token>) – works without login.
// Shows status, ride code, driver + car and a chat with the driver. Refreshes itself every 15 seconds.
import { rpc, T, h, put, ic, busy, toast, fail, dateTime, time, pushSupported, enablePush, sb } from "./core.js";

const root = document.getElementById("ride");
const qs = new URLSearchParams(location.search);
const id = qs.get("b"), token = qs.get("t");
const S = { data: null, seen: new Set(), timer: null, drafting: false };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(first) {
  if (!UUID.test(id || "") || !UUID.test(token || "")) return invalid();
  try {
    const d = await rpc("ride_page", { p_booking_id: id, p_token: token });
    const statusChanged = !S.data || S.data.booking.status !== d.booking.status || JSON.stringify(S.data.progress) !== JSON.stringify(d.progress) || !!S.data.driver !== !!d.driver;
    S.data = d;
    if (first || statusChanged) draw(); else addMessages(d.messages || []);
  } catch (e) {
    if (/not valid/i.test(e.message)) return invalid();
    if (first) { put(root, h("div", { class: "acc-card" }, h("p", {}, T("acc.err.generic")), h("button", { class: "btn btn-gold", onClick: () => load(true) }, "↻"))); }
  }
}
function invalid() {
  clearInterval(S.timer);
  put(root, h("section", { class: "acc-card acc-center" }, ic("close", "acc-big-ic"), h("h1", {}, T("ride.invalid")),
    h("a", { class: "btn btn-gold", href: "tel:+4917643241205" }, T("ride.call"))));
}

const STEPS = [["booked", (p, b) => true], ["driver", (p, b, d) => !!d || !!p.accepted_at], ["onway", (p) => !!p.on_the_way_at], ["arrived", (p) => !!p.arrived_at], ["inCar", (p) => !!p.picked_up_at], ["done", (p) => !!p.completed_at]];

function draw() {
  const { booking: b, driver, vehicle, progress: p = {}, chat_open, office_phone } = S.data;
  const cancelled = ["cancelled", "expired"].includes(b.status);
  const draft = root.querySelector(".ride-input")?.value || "";
  const reached = STEPS.map(([k, test]) => test(p, b, driver));
  const last = reached.lastIndexOf(true);
  S.seen.clear();
  const list = h("div", { class: "ride-msgs", id: "rideMsgs" });
  const input = h("textarea", { class: "acc-input ride-input", rows: 1, maxlength: "1000", placeholder: T("ride.chat.ph") });
  input.value = draft;
  input.addEventListener("input", () => { S.drafting = !!input.value; input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; });
  const send = h("button", { type: "submit", class: "btn btn-gold" }, T("ride.chat.send"));
  const form = h("form", { class: "ride-form", onSubmit: (e) => {
    e.preventDefault(); const text = input.value.trim(); if (!text) return;
    busy(send, async () => {
      try { const m = await rpc("ride_page_send", { p_booking_id: id, p_token: token, p_body: text }); input.value = ""; S.drafting = false; input.style.height = ""; addMessages([m]); }
      catch (err) { fail(/closed/i.test(err.message) ? new Error(T("ride.chat.closed")) : err); }
    });
  } }, input, send);

  put(root,
    h("header", { class: "ride-head" }, h("p", { class: "eyebrow" }, T("ride.kicker"), " · ", b.reference), h("h1", {}, dateTime(b.start)),
      h("span", { class: `acc-badge is-${b.status}` }, T("st." + b.status))),
    cancelled ? h("section", { class: "acc-card acc-warnline" }, T("ride.cancelled")) :
      h("ol", { class: "ride-steps" }, STEPS.map(([k], i) => h("li", { class: (reached[i] ? "is-done" : "") + (i === last ? " is-now" : "") }, h("span", {}), T("ride.step." + k)))),
    h("div", { class: "acc-grid" },
      h("section", { class: "acc-card" },
        b.ride_code && !cancelled ? h("div", { class: "ride-code" }, h("small", {}, T("ride.code")), h("b", {}, b.ride_code), h("p", { class: "acc-muted small" }, T("ride.code.help"))) : null,
        h("dl", { class: "acc-dl" },
          h("div", {}, h("dt", {}, T("ride.driver")), h("dd", {}, driver?.first_name || T("ride.driver.none"))),
          h("div", {}, h("dt", {}, T("ride.vehicle")), h("dd", {}, [vehicle?.name, vehicle?.color, vehicle?.plate].filter(Boolean).join(" · ") || "–")),
          h("div", {}, h("dt", {}, T("ride.when")), h("dd", {}, dateTime(b.start)))),
        h("h3", { class: "ride-sub" }, T("ride.route")),
        h("ol", { class: "acc-route" }, h("li", {}, b.pickup), (b.stops || []).map((s) => h("li", { class: "is-stop" }, s.address)), h("li", { class: "is-dest" }, b.destination)),
        h("div", { class: "acc-row ride-actions" },
          h("a", { class: "btn btn-outline-gold", href: "tel:" + String(office_phone || "+4917643241205").replace(/[^\d+]/g, "") }, ic("phone"), T("ride.call")),
          pushSupported() && Notification.permission === "default" && !cancelled ? h("button", { type: "button", class: "btn btn-outline-gold", onClick: notify }, T("ride.notify")) : null),
        h("p", { class: "acc-muted small" }, T("ride.call.help"))),
      h("section", { class: "acc-card ride-chat" }, h("h2", {}, T("ride.chat")), list,
        chat_open && !cancelled ? form : h("p", { class: "acc-muted" }, T("ride.chat.closed")))),
    h("p", { class: "acc-center" }, h("a", { class: "acc-link", href: "account.html" }, T("ride.account"))));
  addMessages(S.data.messages || []);
  if (!(S.data.messages || []).length) list.append(h("p", { class: "acc-muted ride-empty" }, T("ride.chat.empty")));
}
function addMessages(ms) {
  const list = document.getElementById("rideMsgs"); if (!list) return;
  let added = false;
  for (const m of ms) {
    if (!m || S.seen.has(m.id)) continue;
    S.seen.add(m.id); added = true;
    list.querySelector(".ride-empty")?.remove();
    const who = m.from === "customer" ? "you" : m.from === "office" ? "office" : "driver";
    list.append(h("div", { class: "ride-msg is-" + who }, h("small", {}, T("ride.chat." + who), " · ", time(m.at)), h("p", {}, m.body)));
  }
  if (added) list.scrollTop = list.scrollHeight;
}
async function notify(e) {
  // push needs a customer login – the ride page offers it only for logged-in customers
  const { data } = await sb.auth.getSession();
  if (!data.session) { location.href = "account.html"; return; }
  try { await busy(e.currentTarget, enablePush); toast(T("ride.notify.ok")); e.target.remove(); } catch (err) { fail(err); }
}

document.addEventListener("dd:langchange", () => { if (S.data) draw(); });
put(root, h("div", { class: "acc-loading" }, h("span", { class: "acc-spin" }), h("p", {}, T("ride.loading"))));
load(true);
S.timer = setInterval(() => { if (!document.hidden) load(false); }, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(false); });
