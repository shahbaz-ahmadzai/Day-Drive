// Monthly rides (school / work contracts): requests, price offers, activation, pause / end, driver changes
import { sb, check } from "../core/supabase.js";
import { h, icon, btn, badge, empty, card, toast, toastError, openDrawer, confirmDialog, form, busy, dl, tabs, table, put, pageHeader } from "../core/ui.js";
import { money, date, dateTime, weekdayDate, time, todayISO, fullName, relative } from "../core/format.js";
import { vehicles as loadVehicles, drivers as loadDrivers } from "../core/data.js";
import { can } from "../core/auth.js";

const ST = {
  request: ["New request", "amber"], negotiating: ["Price talk", "amber"], approved: ["Price agreed", "blue"], active: ["Active", "green"],
  paused: ["Paused", "grey"], ended: ["Ended", "grey"], declined: ["Declined", "red"], withdrawn: ["Withdrawn", "grey"],
};
const stBadge = (s) => badge(ST[s]?.[0] || s, ST[s]?.[1] || "grey");
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FILTERS = [["open", "To do"], ["active", "Active"], ["paused", "Paused"], ["done", "Ended / declined"], ["all", "All"]];
const inFilter = (f, s) => f === "all" || (f === "open" ? ["request", "negotiating", "approved"].includes(s) : f === "done" ? ["ended", "declined", "withdrawn"].includes(s) : s === f);
const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw new Error(error.message); return data; };

export default {
  async render(root, { params, setParams, go, refreshBadges }) {
    const editable = can("bookings.edit");
    let filter = params.filter || "open", rows = [];
    root.append(pageHeader("Monthly rides", "Regular rides to school or work: answer requests, agree the price, then the rides are planned automatically.",
      [btn("Customer form", { ic: "external", onClick: () => window.open("../monthly.html", "_blank") })]));
    const bar = h("div", { class: "toolbar" });
    const list = h("div");
    root.append(bar, list);
    const drawBar = () => put(bar, tabs(FILTERS.map(([k, l]) => [k, `${l}${rows.length ? ` (${rows.filter((r) => inFilter(k, r.status)).length})` : ""}`]), (k) => { filter = k; setParams({ filter: k === "open" ? "" : k }); draw(); }, filter));

    async function load() {
      try {
        rows = check(await sb.from("ride_contracts").select("*, customers(first_name, last_name, phone, email), vehicles!ride_contracts_vehicle_id_fkey(display_name), drivers(display_name)").order("created_at", { ascending: false }).limit(300));
        drawBar(); draw();
      } catch (e) { toastError(e); }
    }
    function draw() {
      const shown = rows.filter((r) => inFilter(filter, r.status));
      put(list, card(null, table({
        rows: shown, onRow: (r) => openDetail(r.id),
        emptyEl: empty(filter === "open" ? "No open requests" : "Nothing here", filter === "open" ? "New requests from the website appear here (you also get an SMS)." : null, null, "calendar"),
        columns: [
          { label: "Ref", render: (r) => h("div", {}, h("strong", {}, r.reference), h("small", {}, relative(r.created_at))) },
          { label: "Customer", render: (r) => h("div", {}, fullName(r.customers), h("small", {}, r.customers?.phone || "")) },
          { label: "Plan", render: (r) => h("div", {}, `${date(r.start_date)} – ${date(r.end_date)}`, h("small", {}, `${(r.weekdays || []).map((d) => DAYS[d]).join(" ")} · ${r.trip_type === "one_way" ? "one way" : "round trip"} · ${r.ride_count || "?"} rides`)) },
          { label: "Destination", render: (r) => h("div", {}, r.destination_name || r.destination_address, r.purpose ? h("small", {}, r.purpose) : null) },
          { label: "Price / ride", cls: "right", render: (r) => h("div", {}, h("strong", {}, money(r.agreed_price_per_ride ?? r.initial_price_per_ride)), r.agreed_price_per_ride ? h("small", {}, "agreed") : h("small", {}, "starting price")) },
          { label: "Car / driver", render: (r) => h("div", {}, r.vehicles?.display_name || "–", h("small", {}, r.drivers?.display_name || "")) },
          { label: "Status", render: (r) => stBadge(r.status) },
        ],
      }), { cls: "flush" }));
    }

    async function openDetail(id, tab = "plan") {
      setParams({ filter: filter === "open" ? "" : filter, id });
      const dr = openDrawer({ title: "Monthly rides", body: h("div", { class: "loading" }, h("span", { class: "spin" })), wide: true, onClose: () => setParams({ filter: filter === "open" ? "" : filter }) });
      const drawAll = async (active = tab) => {
        try {
          const [c, pickups, offers] = await Promise.all([
            sb.from("ride_contracts").select("*, customers(*), vehicles!ride_contracts_vehicle_id_fkey(display_name, plate_number), drivers(display_name, phone)").eq("id", id).single().then(check),
            sb.from("ride_contract_pickups").select("*").eq("contract_id", id).order("sort_order").then(check),
            sb.from("ride_contract_offers").select("*").eq("contract_id", id).order("created_at").then(check),
          ]);
          const reqVehicle = c.requested_vehicle_id ? (await loadVehicles()).find((v) => v.id === c.requested_vehicle_id) : null;
          dr.el.querySelector(".drawer-head h2").textContent = `${c.reference} · ${fullName(c.customers)}`;
          const content = h("div");
          const show = async (k) => {
            put(content, h("div", { class: "loading" }, h("span", { class: "spin" })));
            if (k === "plan") {
              const wt = c.weekday_times && typeof c.weekday_times === "object" ? Object.entries(c.weekday_times) : [];
              put(content, h("div", { class: "grid grid-2" },
                h("div", {},
                  h("p", { class: "section-title" }, "Plan"), dl([
                    ["Status", stBadge(c.status)], ["Purpose", c.purpose], ["Period", `${date(c.start_date)} – ${date(c.end_date)}`],
                    ["Days", (c.weekdays || []).map((d) => DAYS[d]).join(", ")],
                    ["Trip", c.trip_type === "one_way" ? "One way" : `Round trip · way back ${String(c.return_time || "").slice(0, 5)}`],
                    wt.length ? ["Other times", wt.map(([d, v]) => `${DAYS[d]}: ${[v.outbound && "pickup " + v.outbound, v.return && "back " + v.return].filter(Boolean).join(", ")}`).join(" · ")] : null,
                    ["Holidays", [c.skip_public_holidays && "no rides on public holidays", c.skip_school_holidays && "no rides in school holidays"].filter(Boolean).join(", ") || "rides also on holidays"],
                    (c.excluded_dates || []).length ? ["Days off", (c.excluded_dates || []).slice().sort().map((d) => date(d)).join(", ")] : null,
                    ["Rides", `${c.ride_count || "–"} planned · ${c.estimated_km ? c.estimated_km + " km" : "? km"} per way${c.estimated_minutes ? " · ~" + c.estimated_minutes + " min" : ""}`],
                    ["Passengers", `${c.passengers} · child seats ${c.child_seats} · bags ${c.luggage}`],
                    (c.children || []).length ? ["Children", c.children.map((x) => [x.name, x.age ? x.age + " y" : null].filter(Boolean).join(" ")).join(", ")] : null,
                  ]),
                  c.customer_notes ? h("div", { class: "note", style: { marginTop: "10px" } }, c.customer_notes) : null),
                h("div", {},
                  h("p", { class: "section-title" }, "Route"),
                  h("ol", { class: "route-list" }, pickups.map((p) => h("li", {}, h("strong", {}, String(p.pickup_time).slice(0, 5)), " ", p.label ? `${p.label} – ` : "", p.address)),
                    h("li", { class: "is-dest" }, h("strong", {}, "→ "), c.destination_name ? `${c.destination_name} – ` : "", c.destination_address)),
                  h("p", { class: "section-title" }, "Customer"), dl([
                    ["Name", fullName(c.customers)], ["Phone", c.customers?.phone ? h("a", { href: `tel:${c.customers.phone.replace(/\s/g, "")}` }, c.customers.phone) : null],
                    ["E-mail", c.customers?.email ? h("a", { href: `mailto:${c.customers.email}` }, c.customers.email) : null], ["Language", c.language],
                    ["Balance", h("a", { href: "#", onClick: (e) => { e.preventDefault(); dr.close(); go("customers", { id: c.customer_id }); } }, "open customer →")],
                  ]),
                  h("p", { class: "section-title" }, "Car & driver"), dl([
                    ["Wished car", reqVehicle?.display_name], ["Car", c.vehicles ? `${c.vehicles.display_name} ${c.vehicles.plate_number || ""}` : null], ["Driver", c.drivers?.display_name],
                  ]))));
            } else if (k === "price") {
              put(content,
                dl([["Starting price", money(c.initial_price_per_ride)], ["Agreed price", c.agreed_price_per_ride ? h("strong", {}, money(c.agreed_price_per_ride)) : "not yet"],
                  ["Total (planned rides)", c.ride_count ? money(Number(c.agreed_price_per_ride ?? c.initial_price_per_ride) * c.ride_count) : null]]),
                h("p", { class: "section-title", style: { marginTop: "14px" } }, "Offers"),
                table({ rows: offers, emptyEl: h("p", { class: "muted" }, "No offers yet."), columns: [
                  { label: "When", render: (o) => dateTime(o.created_at) }, { label: "From", render: (o) => (o.from_party === "office" ? badge("Day Drive", "blue") : badge("Customer", "violet")) },
                  { label: "Price / ride", cls: "right", render: (o) => h("strong", {}, money(o.price_per_ride)) }, { label: "Message", render: (o) => o.note || "–" }, { label: "Status", render: (o) => badge(o.status, o.status === "open" ? "amber" : o.status === "accepted" ? "green" : "grey") }] }),
                editable && ["request", "negotiating"].includes(c.status) ? h("div", { class: "row", style: { marginTop: "12px" } }, btn("Send price offer", { ic: "euro", small: true, onClick: () => sendOffer(c, () => drawAll("price")) })) : null);
            } else if (k === "rides") {
              const rides = check(await sb.from("bookings").select("id, booking_reference, booking_start, contract_leg, status, payment_status, driver_id, vehicle_name, price_amount, drivers(display_name)").eq("contract_id", c.id).order("booking_start").limit(400));
              const up = rides.filter((r) => new Date(r.booking_start) > Date.now() && !["cancelled"].includes(r.status));
              put(content,
                h("p", { class: "muted small", style: { marginBottom: "10px" } }, `${rides.filter((r) => r.status === "completed").length} done · ${up.length} to come · ${rides.filter((r) => r.status === "cancelled").length} cancelled. Planned up to ${c.generated_until ? date(c.generated_until) : "–"}.`),
                table({ rows: rides, onRow: (r) => { dr.close(); go("bookings", { id: r.id, range: "all", status: "all" }); }, emptyEl: empty("No rides planned yet", "Rides are created when you activate the contract.", null, "calendar"),
                  rowClass: (r) => (r.status === "cancelled" ? "is-muted" : ""),
                  columns: [
                    { label: "Day", render: (r) => `${weekdayDate(r.booking_start)} ${time(r.booking_start)}` }, { label: "Way", render: (r) => (r.contract_leg === "return" ? "back" : "there") },
                    { label: "Driver", render: (r) => r.drivers?.display_name || h("span", { class: "muted" }, "open") }, { label: "Price", cls: "right", render: (r) => money(r.price_amount) },
                    { label: "Status", render: (r) => badge(r.status) }] }));
            } else if (k === "settings") {
              const f = form([
                { name: "require_ride_code", label: "Driver must check the 4-digit ride code", type: "checkbox", span: 2, hint: "Usually off for school rides with the same children every day." },
                { name: "charge_no_show", label: "Charge the ride when nobody comes (no-show)", type: "checkbox", span: 2 },
                { name: "allow_balance_extra_rides", label: "Customer may pay extra rides from the balance", type: "checkbox", span: 2 },
                { name: "extra_ride_discount_pct", label: "Discount on extra rides (%)", type: "number", min: 0, max: 50, step: "1" },
                { name: "min_reserved_rides", label: "Balance to keep for rides (number of rides)", type: "number", min: 0, max: 200, hint: "Extra rides may not use this part of the balance." },
                { name: "admin_notes", label: "Internal notes", type: "textarea", rows: 3, span: 2 },
              ], c);
              put(content, f.el, editable ? h("div", { class: "row", style: { marginTop: "10px" } }, btn("Save settings", { variant: "primary", small: true, onClick: (e) => busy(e.currentTarget, async () => {
                try { check(await sb.from("ride_contracts").update(f.values()).eq("id", c.id)); toast("Saved"); } catch (err) { toastError(err); }
              }) })) : null);
            }
          };
          dr.setBody([tabs([["plan", "Plan"], ["price", `Price${offers.some((o) => o.status === "open" && o.from_party === "customer") ? " •" : ""}`], ["rides", "Rides"], ["settings", "Settings"]], show, active), content]);
          show(active);
          const acts = [];
          if (editable) {
            if (["request", "negotiating", "approved", "paused"].includes(c.status)) acts.push(btn(c.status === "paused" ? "Resume" : "Activate & plan rides", { variant: "primary", ic: "check", onClick: () => (c.status === "paused" ? statusChange(c, "active", () => drawAll("rides")) : activate(c, () => drawAll("rides"))) }));
            if (["request", "negotiating"].includes(c.status)) acts.push(btn("Send price offer", { ic: "euro", onClick: () => sendOffer(c, () => drawAll("price")) }));
            if (c.status === "active") acts.push(btn("Change car / driver", { ic: "car", onClick: () => reassign(c, () => drawAll("rides")) }), btn("Pause", { onClick: () => statusChange(c, "paused", () => drawAll("rides")) }), btn("End", { onClick: () => statusChange(c, "ended", () => drawAll("rides")) }));
            if (["request", "negotiating", "approved"].includes(c.status)) acts.push(btn("Decline", { variant: "ghost", onClick: () => statusChange(c, "declined", () => drawAll()) }));
          }
          dr.setFooter(acts.length ? [h("span", { class: "spacer" }), ...acts] : [btn("Close", { onClick: dr.close })]);
        } catch (e) { toastError(e); dr.close(); }
      };
      drawAll();
    }

    function sendOffer(c, after) {
      const f = form([
        { name: "price", label: "Price per ride (EUR)", type: "number", step: "0.5", min: 1, required: true },
        { name: "note", label: "Message to the customer", type: "textarea", rows: 3, placeholder: "e.g. Including child seat. Price for the whole school year." },
      ], { price: c.agreed_price_per_ride ?? c.initial_price_per_ride }, { cols: 1 });
      const m = openDrawer({ title: "Send price offer", subtitle: `${c.reference} · ${c.ride_count || "?"} rides`, body: f.el });
      m.setFooter([btn("Cancel", { onClick: m.close }), btn("Send offer", { variant: "primary", onClick: (e) => {
        if (!f.validate()) return;
        busy(e.currentTarget, async () => {
          try { const v = f.values(); await rpc("admin_contract_offer", { p_contract_id: c.id, p_price: v.price, p_note: v.note }); toast("Offer sent – the customer sees it in My Day Drive"); m.close(); after(); load(); }
          catch (err) { toastError(err); }
        });
      } })]);
    }
    async function activate(c, after) {
      const [vs, ds] = await Promise.all([loadVehicles(), loadDrivers()]);
      const f = form([
        { name: "vehicle_id", label: "Car", type: "select", required: true, placeholder: "Choose…", options: vs.filter((v) => v.status !== "inactive").map((v) => [v.id, `${v.display_name}${v.plate_number ? " · " + v.plate_number : ""} (${v.seats} seats)`]) },
        { name: "driver_id", label: "Driver", type: "select", placeholder: "Later / changes", options: ds.filter((d) => d.status === "active").map((d) => [d.id, d.display_name]) },
        { name: "price", label: "Agreed price per ride (EUR)", type: "number", step: "0.5", min: 1, required: true },
      ], { vehicle_id: c.vehicle_id || c.requested_vehicle_id, driver_id: c.driver_id, price: c.agreed_price_per_ride ?? c.initial_price_per_ride }, { cols: 1 });
      const m = openDrawer({ title: "Activate monthly rides", subtitle: `${c.reference} · ${date(c.start_date)} – ${date(c.end_date)}`,
        body: h("div", {}, h("div", { class: "note", style: { marginBottom: "12px" } }, "All rides of the plan are created as bookings (paid from the customer's balance). The driver gets them in the driver app."), f.el) });
      m.setFooter([btn("Cancel", { onClick: m.close }), btn("Activate", { variant: "primary", onClick: (e) => {
        if (!f.validate()) return;
        busy(e.currentTarget, async () => {
          try { const v = f.values(); const r = await rpc("admin_activate_contract", { p_contract_id: c.id, p_vehicle_id: v.vehicle_id, p_driver_id: v.driver_id, p_price: v.price }); toast(`Active – ${r.created_rides} rides planned`); m.close(); after(); load(); refreshBadges && refreshBadges(); }
          catch (err) { toastError(err); }
        });
      } })]);
    }
    async function reassign(c, after) {
      const [vs, ds] = await Promise.all([loadVehicles(), loadDrivers()]);
      const f = form([
        { name: "vehicle_id", label: "Car", type: "select", required: true, options: vs.filter((v) => v.status !== "inactive").map((v) => [v.id, v.display_name]) },
        { name: "driver_id", label: "Driver", type: "select", placeholder: "No fixed driver", options: ds.filter((d) => d.status === "active").map((d) => [d.id, d.display_name]) },
        { name: "from", label: "From", type: "date", required: true, min: todayISO() },
      ], { vehicle_id: c.vehicle_id, driver_id: c.driver_id, from: todayISO() }, { cols: 1 });
      const m = openDrawer({ title: "Change car / driver", subtitle: c.reference, body: f.el });
      m.setFooter([btn("Cancel", { onClick: m.close }), btn("Change", { variant: "primary", onClick: (e) => {
        if (!f.validate()) return;
        busy(e.currentTarget, async () => {
          try { const v = f.values(); const n = await rpc("admin_contract_reassign", { p_contract_id: c.id, p_vehicle_id: v.vehicle_id, p_driver_id: v.driver_id, p_from: v.from }); toast(`${n} rides changed`); m.close(); after(); load(); }
          catch (err) { toastError(err); }
        });
      } })]);
    }
    async function statusChange(c, status, after) {
      const txt = { paused: ["Pause monthly rides", "Rides from this day on are cancelled. You can resume later.", "Pause"], ended: ["End monthly rides", "Rides from this day on are cancelled and the contract ends.", "End"],
        declined: ["Decline this request", "The customer sees the request as declined.", "Decline"], active: ["Resume monthly rides", "Rides from this day on are planned again.", "Resume"] }[status];
      const f = form([{ name: "from", label: "From", type: "date", required: true, min: todayISO() }, status !== "active" ? { name: "reason", label: "Reason (optional)" } : null], { from: todayISO() }, { cols: 1 });
      const m = openDrawer({ title: txt[0], subtitle: c.reference, body: h("div", {}, h("p", { class: "muted", style: { marginBottom: "12px" } }, txt[1]), f.el) });
      m.setFooter([btn("Cancel", { onClick: m.close }), btn(txt[2], { variant: status === "active" ? "primary" : "danger", onClick: (e) => {
        if (!f.validate()) return;
        busy(e.currentTarget, async () => {
          try { const v = f.values(); const r = await rpc("admin_contract_status", { p_contract_id: c.id, p_status: status, p_from: v.from, p_reason: v.reason || null }); toast(`${txt[2]}: ${r?.rides_changed ?? 0} rides changed`); m.close(); after(); load(); }
          catch (err) { toastError(err); }
        });
      } })]);
    }

    await load();
    if (params.id) openDetail(params.id);
  },
};
