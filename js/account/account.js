// My Day Drive – customer area (account.html)
// Login by SMS code → balance, next ride, bookings (upcoming / not confirmed / not paid / history),
// monthly rides (offers, pause, cancel single days) and the balance statement.
import { sb, rpc, fn, T, h, put, ic, busy, toast, fail, dialog, ask, money, dateTime, dayDate, time, date, todayISO, addDays, parseMoney, statusBadge, payBadge, pushSupported, enablePush } from "./core.js";

const root = document.getElementById("acc");
const S = { tab: "upcoming", ov: null };
const ERR = {
  "Too many codes requested. Please wait 15 minutes.": "acc.err.throttled",
  "Too many wrong codes. Request a new code.": "acc.err.tooMany",
  "The code has expired. Request a new code.": "acc.err.expired",
  "The code is wrong.": "acc.err.wrong",
  "Enter the 6-digit code.": "acc.err.code",
  "Please enter your mobile number.": "acc.err.phone",
};
const msg = (e) => (ERR[e?.message] ? T(ERR[e.message]) : e?.message || T("acc.err.generic"));

/* ============ login ============ */
function loginView() {
  const phone = h("input", { class: "acc-input", id: "accPhone", type: "tel", inputmode: "tel", autocomplete: "tel", placeholder: T("acc.login.phone.ph") });
  const code = h("input", { class: "acc-input acc-code", id: "accCode", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "6", placeholder: "••••••" });
  const err = h("p", { class: "acc-err", role: "alert" });
  const info = h("p", { class: "acc-info" });
  const sendBtn = h("button", { type: "submit", class: "btn btn-gold btn-block" }, T("acc.login.send"));
  const verifyBtn = h("button", { type: "submit", class: "btn btn-gold btn-block" }, T("acc.login.verify"));
  const resend = h("button", { type: "button", class: "acc-link", disabled: true }, T("acc.login.resend"));
  const other = h("button", { type: "button", class: "acc-link" }, T("acc.login.other"));
  let timer;
  const countdown = () => {
    let s = 60; resend.disabled = true; clearInterval(timer);
    const tick = () => { resend.textContent = s > 0 ? T("acc.login.resendIn", { s }) : T("acc.login.resend"); resend.disabled = s > 0; if (s-- <= 0) clearInterval(timer); };
    tick(); timer = setInterval(tick, 1000);
  };
  const step1 = h("form", { class: "acc-form", onSubmit: (e) => { e.preventDefault(); request(); } },
    h("label", { class: "acc-field" }, h("span", {}, T("acc.login.phone")), phone), sendBtn);
  const step2 = h("form", { class: "acc-form", hidden: true, onSubmit: (e) => { e.preventDefault(); verify(); } },
    info, h("label", { class: "acc-field" }, h("span", {}, T("acc.login.code")), code), verifyBtn, h("div", { class: "acc-row" }, resend, other));
  async function request() {
    err.textContent = "";
    if (phone.value.replace(/\D/g, "").length < 7) { err.textContent = T("acc.err.phone"); phone.focus(); return; }
    await busy(sendBtn, async () => {
      try {
        await fn("customer-auth", { action: "request", phone: phone.value.trim(), language: window.DD_LANG });
        info.textContent = T("acc.login.sent");
        step1.hidden = true; step2.hidden = false; code.value = ""; code.focus(); countdown();
      } catch (e) { err.textContent = msg(e); }
    });
  }
  async function verify() {
    err.textContent = "";
    const c = code.value.replace(/\D/g, "");
    if (c.length !== 6) { err.textContent = T("acc.err.code"); code.focus(); return; }
    await busy(verifyBtn, async () => {
      try {
        const r = await fn("customer-auth", { action: "verify", phone: phone.value.trim(), code: c });
        const { error } = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: "magiclink" });
        if (error) throw error;
        clearInterval(timer);
        rpc("customer_set_language", { p_lang: window.DD_LANG === "de" ? "de" : "en" }).catch(() => {});
        start();
      } catch (e) { err.textContent = msg(e); code.select(); }
    });
  }
  code.addEventListener("input", () => { if (code.value.replace(/\D/g, "").length === 6) verify(); });
  resend.addEventListener("click", request);
  other.addEventListener("click", () => { step2.hidden = true; step1.hidden = false; err.textContent = ""; phone.focus(); });
  put(root, h("section", { class: "acc-login" },
    h("div", { class: "acc-login-card" },
      h("p", { class: "eyebrow" }, T("acc.kicker")), h("h1", {}, T("acc.title")), h("p", { class: "acc-lead" }, T("acc.login.lead")),
      step1, step2, err,
      h("p", { class: "acc-muted" }, T("acc.login.none"), " ", h("a", { href: "booking.html" }, T("acc.book"))))));
  setTimeout(() => phone.focus(), 50);
}

/* ============ dashboard ============ */
async function dashboard() {
  put(root, h("div", { class: "acc-loading" }, h("span", { class: "acc-spin" })));
  let ov;
  try { ov = S.ov = await rpc("customer_overview"); }
  catch (e) {
    if (/log in/i.test(e.message)) { await sb.auth.signOut(); loginView(); return; }
    fail(e); put(root, h("div", { class: "acc-card" }, h("p", {}, T("acc.err.generic")), h("button", { class: "btn btn-gold", onClick: dashboard }, "↻")));
    return;
  }
  const c = ov.customer || {};
  const list = h("div", { class: "acc-list" });
  const tabs = h("div", { class: "acc-tabs", role: "tablist" });
  const counts = ov.counts || {};
  const drawTabs = () => put(tabs, ["upcoming", "pending", "unpaid", "history"].map((k) =>
    h("button", { type: "button", role: "tab", class: "acc-tab" + (S.tab === k ? " is-active" : ""), "aria-selected": S.tab === k ? "true" : "false", onClick: () => { S.tab = k; drawTabs(); loadTab(list); } },
      T("acc.tab." + k), counts[k] ? h("span", { class: "acc-count" + (k === "unpaid" ? " is-warn" : "") }, String(counts[k])) : null)));
  drawTabs();

  put(root,
    h("header", { class: "acc-head" },
      h("div", {}, h("p", { class: "eyebrow" }, T("acc.title")), h("h1", {}, T("acc.hello", { name: c.first_name || "" }))),
      h("div", { class: "acc-head-actions" },
        h("a", { class: "btn btn-gold", href: "booking.html" }, T("acc.book")),
        h("button", { type: "button", class: "btn btn-outline-gold", onClick: async () => { await sb.auth.signOut(); loginView(); } }, T("acc.logout")))),
    h("div", { class: "acc-grid" },
      nextRideCard(ov.next_ride),
      balanceCard(ov)),
    pushSupported() && Notification.permission === "default" ? h("button", { type: "button", class: "acc-notice", onClick: async (e) => { try { await busy(e.currentTarget, enablePush); toast(T("ride.notify.ok")); e.target.closest(".acc-notice")?.remove(); } catch (err) { fail(err); } } },
      ic("bell"), T("ride.notify")) : null,
    h("section", { class: "acc-card acc-bookings" }, tabs, list),
    contractsCard(ov.contracts || []),
  );
  loadTab(list);
}

function nextRideCard(b) {
  if (!b) return h("section", { class: "acc-card acc-next is-empty" }, h("h2", {}, T("acc.next")), h("p", { class: "acc-muted" }, T("acc.next.none")),
    h("div", { class: "acc-row" }, h("a", { class: "btn btn-gold", href: "booking.html" }, T("acc.book")), h("a", { class: "btn btn-outline-gold", href: "monthly.html" }, T("acc.requestMonthly"))));
  return h("section", { class: "acc-card acc-next" },
    h("div", { class: "acc-row between" }, h("h2", {}, T("acc.next")), statusBadge(b.status)),
    h("p", { class: "acc-when" }, dateTime(b.start)),
    route(b),
    h("div", { class: "acc-next-meta" },
      b.ride_code ? h("div", { class: "acc-code-box" }, h("small", {}, T("acc.ride.code")), h("b", {}, b.ride_code)) : null,
      h("div", {}, h("small", {}, T("ride.vehicle")), h("b", {}, b.vehicle || "–"), b.plate ? h("small", {}, b.plate) : null),
      h("div", {}, h("small", {}, T("acc.ride.driver")), h("b", {}, b.driver_first_name || T("ride.driver.none")))),
    h("a", { class: "btn btn-gold btn-block", href: rideLink(b) }, T("acc.ride.open"), b.unread ? h("span", { class: "acc-count is-warn" }, String(b.unread)) : null));
}
const rideLink = (b) => `ride.html?b=${encodeURIComponent(b.id)}&t=${encodeURIComponent(b.client_token)}`;
const route = (b) => h("ol", { class: "acc-route" },
  h("li", {}, b.pickup), (Array.isArray(b.stops) ? b.stops : []).map((s) => h("li", { class: "is-stop" }, s.address)), h("li", { class: "is-dest" }, b.destination));

function balanceCard(ov) {
  const hasAny = Number(ov.balance) !== 0 || Number(ov.held) !== 0 || (ov.contracts || []).length;
  return h("section", { class: "acc-card acc-balance" },
    h("h2", {}, T("acc.balance")),
    h("p", { class: "acc-big" }, money(ov.available)), h("small", { class: "acc-muted" }, T("acc.balance.available")),
    h("dl", { class: "acc-dl" },
      h("div", {}, h("dt", {}, T("acc.balance")), h("dd", {}, money(ov.balance))),
      h("div", {}, h("dt", {}, T("acc.balance.reserved")), h("dd", {}, money(ov.held))),
      Number(ov.unpaid_total) > 0 ? h("div", { class: "is-warn" }, h("dt", {}, T("acc.tab.unpaid")), h("dd", {}, money(ov.unpaid_total))) : null),
    hasAny ? h("p", { class: "acc-muted small" }, T("acc.balance.hint")) : null,
    h("button", { type: "button", class: "acc-link", onClick: statement }, T("acc.balance.statement")));
}

async function loadTab(list) {
  put(list, h("div", { class: "acc-loading" }, h("span", { class: "acc-spin" })));
  try {
    const rows = (await rpc("customer_bookings", { p_tab: S.tab, p_limit: 50, p_offset: 0 })) || [];
    const extra = S.tab === "pending" ? (S.ov?.contracts || []).filter((c) => ["request", "negotiating", "approved"].includes(c.status)) : [];
    if (!rows.length && !extra.length) { put(list, h("p", { class: "acc-empty" }, T("acc.empty." + S.tab))); return; }
    put(list,
      S.tab === "unpaid" && Number(S.ov?.unpaid_total) > 0 ? h("p", { class: "acc-warnline" }, T("acc.unpaidTotal", { amount: money(S.ov.unpaid_total) })) : null,
      extra.map(contractRow), rows.map(bookingRow));
  } catch (e) { fail(e); put(list, h("p", { class: "acc-empty" }, T("acc.err.generic"))); }
}

function bookingRow(b) {
  const cancel = b.can_cancel ? h("button", { type: "button", class: "acc-link is-danger", onClick: async (e) => {
    if (!(await ask(T("acc.ride.cancelAsk")))) return;
    busy(e.target, async () => { try { await rpc("customer_cancel_booking", { p_booking_id: b.id, p_reason: null }); toast(T("acc.ride.cancelled")); dashboard(); } catch (err) { fail(err); } });
  } }, T("acc.ride.cancel")) : null;
  return h("article", { class: "acc-ride" },
    h("div", { class: "acc-ride-when" }, h("b", {}, time(b.start)), h("small", {}, dayDate(b.start))),
    h("div", { class: "acc-ride-main" },
      h("div", { class: "acc-row" }, statusBadge(b.status), payBadge(b), b.contract_id ? h("span", { class: "acc-badge is-soft" }, T("acc.contracts")) : null),
      route(b),
      h("p", { class: "acc-muted small" }, [b.reference, b.vehicle, b.driver_first_name ? `${T("acc.ride.driver")}: ${b.driver_first_name}` : null].filter(Boolean).join(" · "),
        b.ride_code ? h("span", { class: "acc-code-inline" }, ` · ${T("acc.ride.code")}: `, h("b", {}, b.ride_code)) : null)),
    h("div", { class: "acc-ride-side" },
      h("b", { class: "acc-price" }, money(b.price)),
      ["cancelled", "expired"].includes(b.status) ? null : h("a", { class: "acc-link", href: rideLink(b) }, T("acc.ride.open"), b.unread ? h("span", { class: "acc-count is-warn" }, String(b.unread)) : null),
      cancel));
}

/* ============ monthly rides ============ */
function contractsCard(list) {
  return h("section", { class: "acc-card acc-contracts" },
    h("div", { class: "acc-row between" }, h("h2", {}, T("acc.contracts")), h("a", { class: "btn btn-outline-gold btn-sm", href: "monthly.html" }, T("acc.requestMonthly"))),
    list.length ? list.map(contractRow) : h("p", { class: "acc-muted" }, T("acc.contracts.none")));
}
function contractRow(c) {
  return h("article", { class: "acc-contract", onClick: () => contractDetail(c.id), tabindex: "0", onKeydown: (e) => { if (e.key === "Enter") contractDetail(c.id); } },
    h("div", {}, h("div", { class: "acc-row" }, h("strong", {}, c.reference), h("span", { class: `acc-badge is-c-${c.status}` }, T("acc.st." + c.status))),
      h("p", {}, c.destination), h("small", { class: "acc-muted" }, T("acc.contract.period", { from: date(c.start_date), to: date(c.end_date) }))),
    h("div", { class: "acc-ride-side" }, c.price_per_ride ? h("b", {}, T("acc.contract.perRide", { price: money(c.price_per_ride) })) : null, h("span", { class: "acc-link" }, T("acc.contract.open"))));
}

async function contractDetail(id) {
  let data;
  try { data = await rpc("customer_contract", { p_contract_id: id }); } catch (e) { fail(e); return; }
  if (!data) return;
  const c = data.contract, pickups = data.pickups || [], offers = data.offers || [];
  const openOffice = offers.filter((o) => o.from === "office" && o.status === "open").pop();
  const days = (c.weekdays || []).map((d) => T("acc.days." + d)).join(", ");
  const wt = c.weekday_times && typeof c.weekday_times === "object" ? Object.entries(c.weekday_times) : [];
  const changed = await dialog(`${c.reference} · ${T("acc.st." + c.status)}`, (done) => {
    const body = h("div", { class: "acc-cdetail" },
      h("section", {}, h("h3", {}, T("acc.contract.schedule")),
        h("p", {}, T("acc.contract.period", { from: date(c.start_date), to: date(c.end_date) }), " · ", days),
        h("p", {}, c.trip_type === "one_way" ? T("acc.contract.oneWay") : T("acc.contract.return", { time: String(c.return_time || "").slice(0, 5) })),
        wt.length ? h("p", { class: "acc-muted small" }, wt.map(([d, v]) => `${T("acc.days." + d)}: ${[v.outbound, v.return].filter(Boolean).join(" / ")}`).join(" · ")) : null,
        data.done !== undefined && c.status === "active" ? h("p", { class: "acc-muted small" }, T("acc.contract.done", { done: data.done, left: data.left })) : null),
      h("section", {}, h("h3", {}, T("acc.contract.pickups")),
        h("ol", { class: "acc-route" }, pickups.map((p) => h("li", {}, h("b", {}, String(p.pickup_time).slice(0, 5)), " ", p.label ? `${p.label} – ` : "", p.address)),
          h("li", { class: "is-dest" }, c.destination_name ? `${c.destination_name} – ` : "", c.destination_address))),
      h("section", {}, h("h3", {}, T("acc.contract.offers")),
        c.agreed_price_per_ride ? h("p", { class: "acc-big-sm" }, T("acc.contract.perRide", { price: money(c.agreed_price_per_ride) }))
          : c.initial_price_per_ride ? h("p", { class: "acc-muted" }, T("acc.contract.perRide", { price: money(c.initial_price_per_ride) })) : null,
        offers.length ? h("ul", { class: "acc-offers" }, offers.map((o) => h("li", { class: "is-" + o.status },
          h("span", {}, T("acc.contract.offerFrom." + (o.from === "office" ? "office" : "customer")), o.note ? h("small", {}, o.note) : null), h("b", {}, money(o.price))))) : null,
        openOffice && ["request", "negotiating"].includes(c.status) ? h("button", { type: "button", class: "btn btn-gold btn-block", onClick: async (e) => {
          busy(e.target, async () => { try { await rpc("customer_accept_offer", { p_offer_id: openOffice.id }); toast(T("acc.contract.accepted")); done(true); } catch (err) { fail(err); } });
        } }, T("acc.contract.accept"), " – ", money(openOffice.price)) : null,
        ["request", "negotiating"].includes(c.status) ? counterForm(c, done) : null),
      (data.upcoming || []).length ? h("section", {}, h("h3", {}, T("acc.contract.upcoming")),
        h("ul", { class: "acc-legs" }, data.upcoming.slice(0, 20).map((b) => h("li", {},
          h("span", {}, dayDate(b.start), " ", time(b.start), " · ", b.contract_leg === "return" ? "↩" : "→"),
          b.can_cancel ? h("button", { type: "button", class: "acc-link is-danger", onClick: async (e) => {
            if (!(await ask(T("acc.contract.skipAsk")))) return;
            busy(e.target, async () => { try { await rpc("customer_cancel_booking", { p_booking_id: b.id, p_reason: "Day cancelled by the customer" }); e.target.closest("li").classList.add("is-off"); e.target.remove(); toast(T("acc.ride.cancelled")); } catch (err) { fail(err); } });
          } }, T("acc.contract.skip")) : statusBadge(b.status))))) : null,
      c.status === "active" ? pauseForm(c, done) : null,
      ["request", "negotiating", "approved"].includes(c.status) ? h("button", { type: "button", class: "acc-link is-danger", onClick: async () => {
        if (!(await ask(T("acc.contract.withdrawAsk")))) return;
        try { await rpc("customer_withdraw_contract", { p_contract_id: c.id }); done(true); } catch (err) { fail(err); }
      } }, T("acc.contract.withdraw")) : null);
    return body;
  }, { wide: true });
  if (changed) dashboard();
}
function counterForm(c, done) {
  const price = h("input", { class: "acc-input", inputmode: "decimal", placeholder: "25,00" });
  const note = h("input", { class: "acc-input" });
  const box = h("details", { class: "acc-counter" }, h("summary", {}, T("acc.contract.counter")),
    h("label", { class: "acc-field" }, h("span", {}, T("acc.contract.counterPrice")), price),
    h("label", { class: "acc-field" }, h("span", {}, T("acc.contract.counterNote")), note),
    h("button", { type: "button", class: "btn btn-outline-gold", onClick: async (e) => {
      const p = parseMoney(price.value); if (!(p > 0)) { price.focus(); return; }
      busy(e.target, async () => { try { await rpc("customer_contract_offer", { p_contract_id: c.id, p_price: p, p_note: note.value.trim() || null }); toast(T("acc.contract.counterSent")); done(true); } catch (err) { fail(err); } });
    } }, T("acc.contract.counterSend")));
  return box;
}
function pauseForm(c, done) {
  const from = h("input", { class: "acc-input", type: "date", min: todayISO(), value: addDays(todayISO(), 1) });
  const to = h("input", { class: "acc-input", type: "date", min: todayISO(), value: addDays(todayISO(), 7) });
  return h("details", { class: "acc-counter" }, h("summary", {}, T("acc.contract.pause")),
    h("div", { class: "acc-grid-2" }, h("label", { class: "acc-field" }, h("span", {}, T("acc.contract.pauseFrom")), from), h("label", { class: "acc-field" }, h("span", {}, T("acc.contract.pauseTo")), to)),
    h("button", { type: "button", class: "btn btn-outline-gold", onClick: async (e) => {
      busy(e.target, async () => { try { const r = await rpc("customer_pause_contract", { p_contract_id: c.id, p_from: from.value, p_to: to.value }); toast(T("acc.contract.paused", { n: r?.cancelled_rides ?? 0 })); done(true); } catch (err) { fail(err); } });
    } }, T("acc.contract.pauseSend")));
}

async function statement() {
  let rows = [];
  try { rows = (await rpc("customer_ledger_list", { p_limit: 200 })) || []; } catch (e) { fail(e); return; }
  dialog(T("acc.balance.statement"), () => rows.length
    ? h("table", { class: "acc-table" }, h("tbody", {}, rows.map((r) => h("tr", {},
        h("td", {}, date(r.date)),
        h("td", {}, h("b", {}, T("led." + r.kind)), r.route ? h("small", {}, (r.booking_start ? dayDate(r.booking_start) + " · " : "") + r.route) : r.reference ? h("small", {}, r.reference) : null),
        h("td", { class: Number(r.amount) < 0 ? "is-neg" : "is-pos" }, money(r.amount))))))
    : h("p", { class: "acc-muted" }, T("acc.balance.empty")), { wide: true });
}

/* ============ start ============ */
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginView();
  dashboard();
}
document.addEventListener("dd:langchange", () => {
  sb.auth.getSession().then(({ data }) => { if (data.session) rpc("customer_set_language", { p_lang: window.DD_LANG === "de" ? "de" : "en" }).catch(() => {}); });
  start();
});
if (new URLSearchParams(location.search).get("tab")) S.tab = new URLSearchParams(location.search).get("tab");
start();
