// Shifts from the driver app: who drove which car when, km, Uber/Bolt earnings, expenses and missing receipts
import { sb, check, signedFileUrl } from "../core/supabase.js";
import { h, icon, btn, badge, empty, card, toastError, openDrawer, dl, table, put, pageHeader } from "../core/ui.js";
import { money, date, dateTime, time, todayISO, plain } from "../core/format.js";
import { drivers as loadDrivers, vehicles as loadVehicles } from "../core/data.js";

const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dur = (a, b) => { const m = Math.max(0, Math.round((new Date(b || Date.now()) - new Date(a)) / 60000)); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
const km = (s) => (s.end_odometer_km != null && s.start_odometer_km != null ? s.end_odometer_km - s.start_odometer_km : null);
const platform = (s) => Number(s.uber_earnings || 0) + Number(s.bolt_earnings || 0) + Number(s.other_platform_earnings || 0);

export default {
  async render(root, { params, setParams, go }) {
    const [drivers, vehicles] = await Promise.all([loadDrivers(), loadVehicles()]);
    let from = params.from || addDays(todayISO(), -13), to = params.to || todayISO(), driver = params.driver || "", vehicle = params.vehicle || "";
    root.append(pageHeader("Shifts", "Work days from the driver app: start and end, car, kilometres, Uber/Bolt earnings and expenses.",
      [btn("Driver app", { ic: "external", onClick: () => window.open("../driver/", "_blank") })]));
    const fFrom = h("input", { class: "input", type: "date", value: from }), fTo = h("input", { class: "input", type: "date", value: to });
    const fDriver = h("select", { class: "input" }, h("option", { value: "" }, "All drivers"), drivers.map((d) => h("option", { value: d.id, selected: d.id === driver }, d.display_name)));
    const fVehicle = h("select", { class: "input" }, h("option", { value: "" }, "All cars"), vehicles.map((v) => h("option", { value: v.id, selected: v.id === vehicle }, v.display_name)));
    const onChange = () => { from = fFrom.value; to = fTo.value; driver = fDriver.value; vehicle = fVehicle.value; setParams({ from, to, driver, vehicle }); load(); };
    [fFrom, fTo, fDriver, fVehicle].forEach((i) => i.addEventListener("change", onChange));
    root.append(h("div", { class: "toolbar" }, fFrom, fTo, fDriver, fVehicle));
    const nowBox = h("div"), kpis = h("div"), list = h("div");
    root.append(nowBox, kpis, list);

    async function load() {
      put(list, h("div", { class: "loading" }, h("span", { class: "spin" })));
      try {
        let qy = sb.from("driver_shifts").select("*, drivers(display_name), vehicles(display_name, plate_number)")
          .gte("started_at", new Date(from + "T00:00:00").toISOString()).lt("started_at", new Date(addDays(to, 1) + "T00:00:00").toISOString())
          .order("started_at", { ascending: false }).limit(500);
        if (driver) qy = qy.eq("driver_id", driver);
        if (vehicle) qy = qy.eq("vehicle_id", vehicle);
        const [rows, open] = await Promise.all([qy.then(check), sb.from("driver_shifts").select("*, drivers(display_name, phone), vehicles(display_name, plate_number)").eq("status", "open").then(check)]);
        const ids = rows.map((s) => s.id);
        const fin = ids.length ? check(await sb.from("finance_entries").select("shift_id, kind, gross_amount, receipt_status, category_code").in("shift_id", ids).eq("status", "active")) : [];
        const exp = {}, miss = {}, dd = {};
        for (const e of fin) {
          if (e.kind === "expense") { exp[e.shift_id] = (exp[e.shift_id] || 0) + Number(e.gross_amount); if (e.receipt_status === "missing") miss[e.shift_id] = (miss[e.shift_id] || 0) + 1; }
        }
        const rides = ids.length ? check(await sb.from("bookings").select("shift_id, collected_amount, status").in("shift_id", ids)) : [];
        for (const r of rides) if (r.status === "completed") dd[r.shift_id] = (dd[r.shift_id] || 0) + 1;

        put(nowBox, open.length ? card(`On duty now (${open.length})`, h("div", { class: "row", style: { gap: "10px" } }, open.map((s) =>
          h("button", { type: "button", class: "chip-card", onClick: () => detail(s.id) }, h("span", { class: "live-dot" }), h("div", {}, h("strong", {}, s.drivers?.display_name), h("small", {}, `${s.vehicles?.display_name} · since ${time(s.started_at)}`))))), {}) : null);
        const closed = rows.filter((s) => s.status === "closed");
        const sum = (f) => closed.reduce((a, s) => a + f(s), 0);
        put(kpis, h("div", { class: "kpis" },
          h("div", { class: "kpi" }, h("div", {}, h("small", {}, "Shifts"), h("strong", {}, String(rows.length)))),
          h("div", { class: "kpi" }, h("div", {}, h("small", {}, "Kilometres"), h("strong", {}, plain(sum((s) => km(s) || 0))))),
          h("div", { class: "kpi" }, h("div", {}, h("small", {}, "Uber"), h("strong", {}, money(sum((s) => Number(s.uber_earnings || 0)))))),
          h("div", { class: "kpi" }, h("div", {}, h("small", {}, "Bolt"), h("strong", {}, money(sum((s) => Number(s.bolt_earnings || 0)))))),
          h("div", { class: "kpi" }, h("div", {}, h("small", {}, "Expenses"), h("strong", { class: "money-neg" }, money(Object.values(exp).reduce((a, b) => a + b, 0)))))));
        put(list, card(null, table({
          rows, onRow: (s) => detail(s.id),
          emptyEl: empty("No shifts in this time", "Drivers start and end work in the driver app. Give them access on the driver's page → Driver app.", null, "clock"),
          columns: [
            { label: "Day", render: (s) => h("div", {}, h("strong", {}, date(s.started_at)), h("small", {}, `${time(s.started_at)} – ${s.ended_at ? time(s.ended_at) : "…"} · ${dur(s.started_at, s.ended_at)}`)) },
            { label: "Driver", render: (s) => s.drivers?.display_name },
            { label: "Car", render: (s) => h("div", {}, s.vehicles?.display_name, h("small", {}, s.vehicles?.plate_number || "")) },
            { label: "km", cls: "right", render: (s) => (km(s) != null ? plain(km(s)) : "–") },
            { label: "Uber / Bolt / other", cls: "right", render: (s) => (s.status === "open" ? "–" : h("div", {}, h("strong", {}, money(platform(s))), h("small", {}, `${money(s.uber_earnings)} / ${money(s.bolt_earnings)} / ${money(s.other_platform_earnings)}`))) },
            { label: "Day Drive rides", cls: "right", render: (s) => String(dd[s.id] || 0) },
            { label: "Expenses", cls: "right", render: (s) => h("div", {}, money(exp[s.id] || 0), miss[s.id] ? h("small", { class: "money-neg" }, `${miss[s.id]} receipt missing`) : null) },
            { label: "Status", render: (s) => (s.status === "open" ? badge("on duty", "green") : badge("closed", "grey")) },
          ],
        }), { cls: "flush" }));
      } catch (e) { toastError(e); put(list); }
    }

    async function detail(id) {
      const dr = openDrawer({ title: "Shift", body: h("div", { class: "loading" }, h("span", { class: "spin" })), wide: true });
      try {
        const [s, fin, rides, ev] = await Promise.all([
          sb.from("driver_shifts").select("*, drivers(display_name, phone), vehicles(display_name, plate_number)").eq("id", id).single().then(check),
          sb.from("finance_entries").select("id, entry_no, kind, category_code, description, gross_amount, payment_method, receipt_status, receipt_path, no_receipt_reason, created_at").eq("shift_id", id).eq("status", "active").order("created_at").then(check),
          sb.from("bookings").select("id, booking_reference, booking_start, status, price_amount, collected_method, collected_amount, code_verified").eq("shift_id", id).order("booking_start").then(check),
          sb.from("vehicle_events").select("event_type, source, occurred_at, data").eq("shift_id", id).order("occurred_at").then(check),
        ]);
        dr.el.querySelector(".drawer-head h2").textContent = `Shift #${s.shift_no} · ${s.drivers?.display_name}`;
        const expenses = fin.filter((e) => e.kind === "expense"), income = fin.filter((e) => e.kind === "income");
        const mapLink = (lat, lng) => (lat && lng ? h("a", { href: `https://www.google.com/maps?q=${lat},${lng}`, target: "_blank", rel: "noopener" }, "map") : null);
        dr.setBody(h("div", {},
          h("div", { class: "grid grid-2" },
            h("div", {}, h("p", { class: "section-title" }, "Work"), dl([
              ["Driver", s.drivers?.display_name], ["Car", `${s.vehicles?.display_name || ""} ${s.vehicles?.plate_number || ""}`],
              ["Start", h("span", {}, dateTime(s.started_at), " ", mapLink(s.start_lat, s.start_lng))], ["End", s.ended_at ? h("span", {}, dateTime(s.ended_at), " ", mapLink(s.end_lat, s.end_lng)) : badge("on duty", "green")],
              ["Working time", dur(s.started_at, s.ended_at)],
              ["Odometer", `${s.start_odometer_km != null ? plain(s.start_odometer_km) : "?"} → ${s.end_odometer_km != null ? plain(s.end_odometer_km) : "?"} km${km(s) != null ? ` (${plain(km(s))} km)` : ""}`],
              ["Starter box", s.device_confirmed_at ? `confirmed ${time(s.device_confirmed_at)} (${s.unlock_method || ""})` : "no signal"],
            ]), s.report_note ? h("div", { class: "note", style: { marginTop: "10px" } }, s.report_note) : null),
            h("div", {}, h("p", { class: "section-title" }, "Earnings reported"), dl([
              ["Uber", money(s.uber_earnings)], ["Bolt", money(s.bolt_earnings)], ["Other platforms", money(s.other_platform_earnings)],
              ["Own cash rides", money(s.cash_earnings)], ["Own card rides", money(s.card_earnings)],
              ["Booked in Finance", `${income.length} entries · ${money(income.reduce((a, e) => a + Number(e.gross_amount), 0))}`],
            ]))),
          h("p", { class: "section-title" }, `Expenses (${expenses.length})`),
          table({ rows: expenses, emptyEl: h("p", { class: "muted" }, "No expenses."), columns: [
            { label: "Time", render: (e) => time(e.created_at) }, { label: "What", render: (e) => h("div", {}, e.category_code.replace(/_/g, " "), h("small", {}, e.description)) },
            { label: "Paid", key: "payment_method" }, { label: "Amount", cls: "right", render: (e) => money(e.gross_amount) },
            { label: "Receipt", render: (e) => (e.receipt_path ? btn("Open", { small: true, ic: "eye", onClick: async () => { try { window.open(await signedFileUrl("receipts", e.receipt_path, 120), "_blank"); } catch (err) { toastError(err); } } })
              : h("div", {}, badge("missing", "red"), e.no_receipt_reason ? h("small", {}, e.no_receipt_reason) : null)) }] }),
          h("p", { class: "section-title" }, `Day Drive rides (${rides.length})`),
          table({ rows: rides, onRow: (r) => { dr.close(); go("bookings", { id: r.id, range: "all", status: "all" }); }, emptyEl: h("p", { class: "muted" }, "No Day Drive rides in this shift."), columns: [
            { label: "Time", render: (r) => time(r.booking_start) }, { label: "Ref", key: "booking_reference" }, { label: "Price", cls: "right", render: (r) => money(r.price_amount) },
            { label: "Collected", render: (r) => (r.collected_method && r.collected_method !== "none" ? `${r.collected_method} ${money(r.collected_amount)}` : "–") },
            { label: "Code", render: (r) => (r.code_verified ? badge("checked", "green") : "–") }, { label: "Status", render: (r) => badge(r.status) }] }),
          ev.length ? [h("p", { class: "section-title" }, "Car log"), h("ul", { class: "timeline" }, ev.map((e) => h("li", {}, h("small", {}, time(e.occurred_at)), " ", e.event_type.replace(/_/g, " "), e.source === "device" ? h("small", {}, " · starter box") : null)))] : null));
        dr.setFooter([btn("Close", { onClick: dr.close })]);
      } catch (e) { toastError(e); dr.close(); }
    }

    await load();
  },
};
