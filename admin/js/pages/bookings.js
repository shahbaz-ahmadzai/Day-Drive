// Bookings: list with filters, detail panel (assign, status, SMS, notes, timeline), phone bookings
import { sb, check, callFunction } from "../core/supabase.js";
import { h, icon, btn, badge, table, empty, card, toast, toastError, openDrawer, confirmDialog, form, busy, debounce, dl, clear, statusLabel, downloadText, toCSV, put } from "../core/ui.js";
import { money, dateTime, date, time, weekdayDate, num, berlinLocalToISO, isoToBerlinLocal, todayISO, relative } from "../core/format.js";
import { vehicles as loadVehicles, drivers as loadDrivers, SERVICE_TYPES, BOOKING_STATUSES, PAYMENT_STATUSES, serviceLabel } from "../core/data.js";
import { can, me } from "../core/auth.js";

const PAGE = 50;
const ACTIVE = ["confirmed", "assigned", "on_the_way", "in_progress"];
const NEXT = { confirmed: ["on_the_way"], assigned: ["on_the_way", "in_progress"], on_the_way: ["in_progress"], in_progress: ["completed"] };

function rangeBounds(range) {
  const today = todayISO();
  const d = (iso, add) => { const x = new Date(iso + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + add); return x.toISOString().slice(0, 10); };
  const start = (iso) => berlinLocalToISO(iso + "T00:00");
  switch (range) {
    case "today": return [start(today), start(d(today, 1))];
    case "tomorrow": return [start(d(today, 1)), start(d(today, 2))];
    case "week": return [new Date().toISOString(), start(d(today, 8))];
    case "upcoming": return [new Date(Date.now() - 3 * 3600000).toISOString(), null];
    case "past": return [null, new Date().toISOString()];
    default: return [null, null];
  }
}

export default {
  async render(root, { params, setParams, go, refreshBadges }) {
    const state = {
      q: params.q || "", status: params.status || "active", range: params.range || "upcoming",
      nodriver: params.nodriver === "1", page: Number(params.page || 0),
    };
    const editable = can("bookings.edit");

    root.append(h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Bookings"), h("p", { class: "muted" }, "Website, phone and partner bookings in one list.")),
      h("div", { class: "page-actions" },
        btn("Export CSV", { ic: "download", onClick: exportCsv }),
        editable ? btn("New booking", { variant: "primary", ic: "plus", onClick: () => openEditor() }) : null)));

    // toolbar
    const search = h("input", { class: "input", type: "search", placeholder: "Reference, name, phone, e-mail…", value: state.q });
    const statusSel = h("select", { class: "input" },
      [["active", "Open rides"], ["all", "All statuses"], ...BOOKING_STATUSES].map(([v, t]) => h("option", { value: v, selected: v === state.status }, t)));
    const rangeSel = h("select", { class: "input" },
      [["upcoming", "Upcoming"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "Next 7 days"], ["past", "Past"], ["all", "Any date"]].map(([v, t]) => h("option", { value: v, selected: v === state.range }, t)));
    const noDriver = h("input", { type: "checkbox", checked: state.nodriver });
    root.append(h("div", { class: "toolbar" },
      h("label", { class: "search" }, icon("search", 16), search), statusSel, rangeSel,
      h("label", { class: "check", style: { padding: "0 4px" } }, noDriver, h("span", {}, "Without driver"))));

    const listCard = h("div", {});
    root.append(listCard);

    const sync = () => setParams({ q: state.q, status: state.status === "active" ? "" : state.status, range: state.range === "upcoming" ? "" : state.range, nodriver: state.nodriver ? "1" : "", page: state.page || "" });
    search.addEventListener("input", debounce(() => { state.q = search.value.trim(); state.page = 0; sync(); load(); }, 300));
    statusSel.addEventListener("change", () => { state.status = statusSel.value; state.page = 0; sync(); load(); });
    rangeSel.addEventListener("change", () => { state.range = rangeSel.value; state.page = 0; sync(); load(); });
    noDriver.addEventListener("change", () => { state.nodriver = noDriver.checked; state.page = 0; sync(); load(); });

    function query(sel = "*", opts = {}) {
      let q = sb.from("bookings").select(sel, opts);
      if (state.status === "active") q = q.in("status", ACTIVE);
      else if (state.status !== "all") q = q.eq("status", state.status);
      if (state.nodriver) q = q.is("driver_id", null);
      const [from, to] = rangeBounds(state.range);
      if (from) q = q.gte("booking_start", from);
      if (to) q = q.lt("booking_start", to);
      if (state.q) {
        const s = state.q.replace(/[%,()"]/g, " ").trim();
        q = q.or(`booking_reference.ilike.%${s}%,customer_last_name.ilike.%${s}%,customer_first_name.ilike.%${s}%,customer_phone.ilike.%${s}%,customer_email.ilike.%${s}%`);
      }
      return q.order("booking_start", { ascending: state.range !== "past" });
    }

    let drivers = [];
    async function load() {
      clear(listCard).append(card(null, h("div", { class: "loading" }, h("span", { class: "spin" }), "Loading bookings…"), { cls: "flush" }));
      try {
        drivers = await loadDrivers();
        const { data, count } = check(await query("*", { count: "exact" }).range(state.page * PAGE, state.page * PAGE + PAGE - 1));
        const driverName = (id) => drivers.find((d) => d.id === id)?.display_name;
        const tbl = table({
          rows: data, onRow: (r) => openDetail(r.id),
          rowClass: (r) => (["cancelled", "expired"].includes(r.status) ? "is-muted" : ""),
          emptyEl: empty("No bookings found", state.q ? "Try another search." : "Change the filters to see more bookings.", null, "calendar"),
          columns: [
            { label: "Pickup", render: (r) => h("div", {}, h("strong", {}, `${weekdayDate(r.booking_start)}, ${time(r.booking_start)}`), h("small", {}, r.booking_reference)) },
            { label: "Customer", render: (r) => h("div", {}, h("strong", {}, `${r.customer_first_name} ${r.customer_last_name}`), h("small", {}, r.customer_phone || r.customer_email || "")) },
            { label: "Route", render: (r) => h("div", { style: { maxWidth: "320px" } }, h("div", { class: "nowrap", style: { overflow: "hidden", textOverflow: "ellipsis" } }, r.pickup_address), h("small", { class: "nowrap", style: { overflow: "hidden", textOverflow: "ellipsis" } }, "→ " + r.destination_address)) },
            { label: "Vehicle / driver", render: (r) => h("div", {}, h("div", {}, r.vehicle_name || "–"), r.driver_id ? h("small", {}, driverName(r.driver_id) || "Driver") : h("small", { class: "money-neg" }, "No driver")) },
            { label: "Price", cls: "right", render: (r) => h("div", {}, h("strong", {}, money(r.price_amount)), h("small", {}, statusLabel(r.payment_status))) },
            { label: "Status", render: (r) => badge(r.status) },
          ],
        });
        const pages = Math.ceil((count || 0) / PAGE);
        clear(listCard).append(card(null, h("div", {}, tbl,
          count > PAGE ? h("div", { class: "pager" }, h("span", {}, `${state.page * PAGE + 1}–${Math.min(count, (state.page + 1) * PAGE)} of ${count}`),
            h("div", { class: "row" },
              btn("Previous", { small: true, ic: "chevronLeft", disabled: state.page === 0, onClick: () => { state.page--; sync(); load(); } }),
              btn("Next", { small: true, disabled: state.page >= pages - 1, onClick: () => { state.page++; sync(); load(); } })))
            : count ? h("div", { class: "pager" }, h("span", {}, `${count} booking${count > 1 ? "s" : ""}`)) : null), { cls: "flush" }));
      } catch (e) { toastError(e); clear(listCard); }
    }

    async function exportCsv() {
      try {
        const rows = check(await query("*").limit(5000));
        const cols = [
          { label: "Reference", value: (r) => r.booking_reference }, { label: "Pickup date", value: (r) => date(r.booking_start) }, { label: "Time", value: (r) => time(r.booking_start) },
          { label: "Status", value: (r) => statusLabel(r.status) }, { label: "Service", value: (r) => serviceLabel(r.service_type) }, { label: "Source", value: (r) => r.source },
          { label: "First name", value: (r) => r.customer_first_name }, { label: "Last name", value: (r) => r.customer_last_name },
          { label: "Phone", value: (r) => r.customer_phone }, { label: "E-mail", value: (r) => r.customer_email },
          { label: "From", value: (r) => r.pickup_address }, { label: "To", value: (r) => r.destination_address }, { label: "km", value: (r) => num(r.distance_km) },
          { label: "Vehicle", value: (r) => r.vehicle_name }, { label: "Driver", value: (r) => drivers.find((d) => d.id === r.driver_id)?.display_name || "" },
          { label: "Price EUR", value: (r) => num(r.price_amount) }, { label: "Payment", value: (r) => statusLabel(r.payment_status) },
        ];
        downloadText(`day-drive-bookings-${todayISO()}.csv`, toCSV(rows, cols));
      } catch (e) { toastError(e); }
    }

    /* ---------------- detail panel ---------------- */
    async function openDetail(id) {
      setParams({ ...Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || "")), id });
      const d = openDrawer({ title: "Booking", body: h("div", { class: "loading" }, h("span", { class: "spin" })), wide: true,
        onClose: () => { const p = Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || "")); delete p.id; setParams(p); } });
      const draw = async () => {
        try {
          const [b, events, vList, dList, sms] = await Promise.all([
            sb.from("bookings").select("*").eq("id", id).single().then(check),
            sb.from("booking_events").select("*").eq("booking_id", id).order("created_at", { ascending: false }).then(check),
            loadVehicles(), loadDrivers(),
            sb.from("notifications").select("status, created_at, recipient, error, template").eq("booking_id", id).order("created_at", { ascending: false }).then(check),
          ]);
          d.el.querySelector(".drawer-head h2").textContent = b.booking_reference || "Booking";
          d.el.querySelector(".drawer-head .muted")?.remove();
          d.el.querySelector(".drawer-head > div").append(h("p", { class: "muted small row", style: { marginTop: "4px" } }, badge(b.status), badge(b.payment_status), h("span", {}, `via ${b.source}`)));

          const isOpen = ACTIVE.includes(b.status);
          const stops = Array.isArray(b.stops) ? b.stops : [];
          const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(b.pickup_address)}&destination=${encodeURIComponent(b.destination_address)}` +
            (stops.length ? `&waypoints=${encodeURIComponent(stops.map((s) => s.address).join("|"))}` : "");

          // assignment controls
          const vSel = h("select", { class: "input", disabled: !editable || !isOpen },
            h("option", { value: "" }, "– no vehicle –"),
            vList.filter((v) => v.status !== "inactive" || v.id === b.vehicle_id).map((v) => h("option", { value: v.id, selected: v.id === b.vehicle_id }, `${v.display_name}${v.plate_number ? " · " + v.plate_number : ""} (${v.seats} seats)`)));
          const dSel = h("select", { class: "input", disabled: !editable || !isOpen },
            h("option", { value: "" }, "– no driver –"),
            dList.filter((x) => x.status === "active" || x.id === b.driver_id).map((x) => h("option", { value: x.id, selected: x.id === b.driver_id }, x.display_name)));
          const saveAssign = btn("Save assignment", { small: true, variant: "primary", onClick: (e) => busy(e.currentTarget, async () => {
            try {
              const vehicleId = vSel.value || null, driverId = dSel.value || null;
              const warn = await conflicts(b, vehicleId, driverId);
              if (warn && !(await confirmDialog({ title: "Possible double booking", message: warn + " Save anyway?", confirmText: "Save anyway" }))) return;
              const v = vList.find((x) => x.id === vehicleId);
              const patch = { vehicle_id: vehicleId, vehicle_name: v ? v.display_name : null, driver_id: driverId };
              if (driverId && b.status === "confirmed") patch.status = "assigned";
              if (!driverId && b.status === "assigned") patch.status = "confirmed";
              check(await sb.from("bookings").update(patch).eq("id", b.id));
              toast("Assignment saved"); refreshBadges(); draw(); load();
            } catch (err) { toastError(err); }
          }) });

          const notes = h("textarea", { class: "input", rows: 3, placeholder: "Internal notes (not visible to the customer)", disabled: !editable });
          notes.value = b.admin_notes || "";
          const saveNotes = btn("Save notes", { small: true, onClick: (e) => busy(e.currentTarget, async () => {
            try { check(await sb.from("bookings").update({ admin_notes: notes.value.trim() || null }).eq("id", b.id)); toast("Notes saved"); } catch (err) { toastError(err); }
          }) });

          const smsSent = sms.filter((s) => s.template === "booking_confirmation");

          // progress from the driver app + chat between customer, driver and office
          const prog = [["Accepted", b.driver_accepted_at], ["On the way", b.on_the_way_at], ["Arrived", b.arrived_at], ["Picked up", b.picked_up_at], ["Completed", b.completed_at]].filter(([, v]) => v);
          const chatBox = h("div", { class: "chat-box" });
          const drawChat = async () => {
            const msgs = check(await sb.from("ride_messages").select("id, sender_type, body, created_at").eq("booking_id", b.id).order("created_at"));
            put(chatBox, msgs.length ? msgs.map((m) => h("div", { class: "chat-msg is-" + m.sender_type }, h("small", {}, `${{ customer: "Customer", driver: "Driver", office: "Office" }[m.sender_type] || m.sender_type} · ${dateTime(m.created_at)}`), h("p", {}, m.body)))
              : h("p", { class: "muted small" }, "No messages yet. Customer and driver can chat on the ride page / in the driver app."));
            chatBox.scrollTop = chatBox.scrollHeight;
            if (msgs.some((m) => m.sender_type !== "office")) sb.rpc("mark_ride_messages_read", { p_booking_id: b.id }).then(() => {});
          };
          const chatInput = h("input", { class: "input", placeholder: "Message to customer and driver…", maxlength: "1000" });
          const chatForm = h("form", { class: "chat-form", onSubmit: (e) => { e.preventDefault(); const text = chatInput.value.trim(); if (!text) return;
            busy(e.submitter, async () => { try { const { error } = await sb.rpc("send_ride_message", { p_booking_id: b.id, p_body: text }); if (error) throw new Error(error.message); chatInput.value = ""; drawChat(); } catch (err) { toastError(err); } }); } },
            chatInput, btn("Send", { type: "submit", small: true, variant: "primary" }));
          drawChat().catch(() => put(chatBox, h("p", { class: "muted small" }, "Chat could not be loaded.")));
          const rideLink = b.client_token ? new URL(`../ride.html?b=${b.id}&t=${b.client_token}`, location.href).href : null;
          d.setBody(h("div", {},
            h("div", { class: "grid grid-2" },
              h("div", {},
                h("p", { class: "section-title" }, "Trip"),
                h("div", { class: "route" },
                  h("div", { class: "route-pt" }, h("i"), h("div", {}, h("strong", {}, b.pickup_address), h("small", {}, `${dateTime(b.booking_start)}`))),
                  stops.map((s, i) => h("div", { class: "route-pt stop" }, h("i"), h("div", {}, h("span", {}, s.address), h("small", {}, `Stop ${i + 1}${s.waitMinutes ? ` · waits ${s.waitMinutes} min` : ""}`)))),
                  h("div", { class: "route-pt dest" }, h("i"), h("div", {}, h("strong", {}, b.destination_address), h("small", {}, `arrival approx. ${time(b.booking_end)}`)))),
                h("div", { style: { marginTop: "10px" } }, h("a", { href: mapsUrl, target: "_blank", rel: "noopener", class: "btn btn-sm" }, icon("pin", 15), "Open in Google Maps"))),
              h("div", {},
                h("p", { class: "section-title" }, "Details"),
                dl([
                  ["Service", serviceLabel(b.service_type)],
                  ["Distance", b.distance_km ? `${num(b.distance_km, 1)} km` : null],
                  ["Duration", b.duration_minutes ? `${b.duration_minutes} min${b.wait_minutes ? ` (incl. ${b.wait_minutes} min waiting)` : ""}` : null],
                  ["Passengers", `${b.passengers} · ${b.luggage} bags`],
                  b.flight_number ? ["Flight", b.flight_number] : null,
                  ["Ride code", h("span", { class: "mono" }, b.ride_code || "–")],
                  ["Booked", `${dateTime(b.created_at)} (${relative(b.created_at)})`],
                ]))),

            h("p", { class: "section-title" }, "Customer"),
            h("div", { class: "grid grid-2" },
              dl([["Name", `${b.customer_first_name} ${b.customer_last_name}`], ["Language", b.language === "en" ? "English" : "German"]]),
              h("div", { class: "row" },
                b.customer_phone ? h("a", { class: "btn btn-sm", href: `tel:${b.customer_phone.replace(/\s/g, "")}` }, icon("phone", 15), b.customer_phone) : null,
                b.customer_email ? h("a", { class: "btn btn-sm", href: `mailto:${b.customer_email}?subject=${encodeURIComponent("Day Drive – " + b.booking_reference)}` }, icon("mail", 15), b.customer_email) : null)),
            b.customer_notes ? h("div", { class: "note gold", style: { marginTop: "10px" } }, h("strong", {}, "Customer note: "), b.customer_notes) : null,

            h("p", { class: "section-title" }, "Vehicle & driver"),
            h("div", { class: "form cols-2" },
              h("label", { class: "field" }, h("span", { class: "field-label" }, "Vehicle"), vSel),
              h("label", { class: "field" }, h("span", { class: "field-label" }, "Driver"), dSel),
              editable && isOpen ? h("div", { class: "form-actions span-2" }, saveAssign) : null),
            prog.length ? h("p", { class: "progress-list", style: { marginTop: "8px" } }, prog.map(([k, v]) => h("span", {}, `${k} `, h("b", {}, time(v)))), b.code_verified ? h("span", {}, "· code checked") : null,
              b.collected_method && b.collected_method !== "none" ? h("span", {}, `· collected ${b.collected_method} ${money(b.collected_amount)}`) : null) : null,

            h("p", { class: "section-title" }, "Chat"),
            chatBox, editable ? chatForm : null,
            rideLink ? h("p", { class: "muted small", style: { marginTop: "6px" } }, "Customer ride page: ", h("a", { href: rideLink, target: "_blank", rel: "noopener" }, "open"), " · ",
              h("a", { href: "#", onClick: (e) => { e.preventDefault(); navigator.clipboard?.writeText(rideLink).then(() => toast("Link copied")); } }, "copy link")) : null,

            h("p", { class: "section-title" }, "Payment"),
            dl([
              ["Price", h("strong", {}, money(b.price_amount))],
              b.wait_fee > 0 ? ["of which waiting", money(b.wait_fee)] : null,
              ["Payment", badge(b.payment_status)],
              b.payment_method ? ["Method", b.payment_method] : null,
              b.paid_at ? ["Paid at", dateTime(b.paid_at)] : null,
              b.refunded_amount > 0 ? ["Refunded", money(b.refunded_amount)] : null,
              b.cancel_reason ? ["Cancel reason", b.cancel_reason] : null,
            ]),

            h("p", { class: "section-title" }, "Internal notes"),
            notes, editable ? h("div", { class: "form-actions", style: { marginTop: "8px" } }, saveNotes) : null,

            h("p", { class: "section-title" }, "SMS"),
            smsSent.length ? h("p", { class: "small" }, smsSent.map((s) => h("span", { class: "row" }, badge(s.status), `${s.recipient} · ${dateTime(s.created_at)}`, s.error ? h("span", { class: "money-neg" }, s.error) : null)))
              : h("p", { class: "muted small" }, "No confirmation SMS sent yet."),

            h("p", { class: "section-title" }, "History"),
            events.length ? h("ul", { class: "timeline" }, events.map((e) => h("li", {}, h("strong", {}, e.message || statusLabel(e.event_type)), h("small", {}, dateTime(e.created_at)))))
              : h("p", { class: "muted small" }, "No history yet.")));

          // footer actions
          const actions = [];
          if (editable && isOpen) {
            actions.push(btn("Cancel ride", { variant: "ghost", ic: "x", onClick: () => cancelRide(b, d.close) }));
            actions.push(h("span", { class: "spacer" }));
            actions.push(btn("Send SMS", { ic: "sms", onClick: (e) => busy(e.currentTarget, async () => {
              if (!b.customer_phone) return toastError(new Error("This booking has no phone number."));
              if (smsSent.some((s) => s.status === "sent") && !(await confirmDialog({ title: "Send again?", message: "A confirmation SMS was already sent for this booking.", confirmText: "Send again" }))) return;
              try { const r = await callFunction("booking-sms", { bookingId: b.id, template: "confirmation" }); toast(`SMS sent to ${r.to}`); draw(); } catch (err) { toastError(err); }
            }) }));
            actions.push(btn("Edit", { ic: "edit", onClick: () => openEditor(b, () => { draw(); load(); }) }));
            for (const st of NEXT[b.status] || []) {
              actions.push(btn(st === "completed" ? "Mark completed" : statusLabel(st), { variant: st === "completed" ? "primary" : "", ic: st === "completed" ? "check" : null,
                onClick: (e) => busy(e.currentTarget, async () => {
                  if (st === "assigned" && !b.driver_id) return toastError(new Error("Choose a driver first and save the assignment."));
                  if (st === "completed") return completeRide(b, draw);
                  try { check(await sb.from("bookings").update({ status: st }).eq("id", b.id)); toast("Status: " + statusLabel(st)); draw(); load(); } catch (err) { toastError(err); }
                }) }));
            }
          } else if (editable && ["completed", "no_show", "cancelled"].includes(b.status)) {
            actions.push(h("span", { class: "spacer" }));
            if (b.status === "completed") actions.push(btn("Record income", { ic: "euro", onClick: () => completeRide(b, draw, true) }));
          }
          if (editable && isOpen && new Date(b.booking_start) < new Date()) {
            actions.splice(1, 0, btn("No-show", { variant: "ghost", onClick: async () => {
              if (!(await confirmDialog({ title: "Mark as no-show?", message: "The customer did not appear. The ride will be closed.", confirmText: "Mark no-show", danger: true }))) return;
              try { check(await sb.from("bookings").update({ status: "no_show" }).eq("id", b.id)); toast("Marked as no-show"); draw(); load(); refreshBadges(); } catch (err) { toastError(err); }
            } }));
          }
          d.setFooter(actions.length ? actions : [btn("Close", { onClick: d.close })]);
        } catch (e) { toastError(e); d.close(); }
      };
      draw();
    }

    async function conflicts(b, vehicleId, driverId) {
      if (!vehicleId && !driverId) return "";
      const buf = 30 * 60000;
      const from = new Date(new Date(b.booking_start).getTime() - buf).toISOString();
      const to = new Date(new Date(b.booking_end).getTime() + buf).toISOString();
      let q = sb.from("bookings").select("booking_reference, vehicle_id, driver_id, booking_start").neq("id", b.id || "00000000-0000-0000-0000-000000000000")
        .in("status", [...ACTIVE, "pending_payment"]).lt("booking_start", to).gt("booking_end", from);
      const ors = [vehicleId ? `vehicle_id.eq.${vehicleId}` : null, driverId ? `driver_id.eq.${driverId}` : null].filter(Boolean).join(",");
      const rows = check(await q.or(ors));
      if (!rows.length) return "";
      return rows.map((r) => `${r.booking_reference} at ${time(r.booking_start)} uses the same ${r.vehicle_id === vehicleId ? "vehicle" : "driver"}.`).join(" ");
    }

    async function cancelRide(b, closeDrawer) {
      const reason = await confirmDialog({ title: `Cancel ${b.booking_reference}?`, message: "The vehicle becomes free again. Please inform the customer.", confirmText: "Cancel ride", danger: true,
        input: { label: "Reason", placeholder: "e.g. customer called to cancel", required: true } });
      if (!reason) return;
      try {
        check(await sb.from("bookings").update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason }).eq("id", b.id));
        toast("Ride cancelled"); closeDrawer(); load(); refreshBadges();
      } catch (e) { toastError(e); }
    }

    async function completeRide(b, redraw, onlyIncome = false) {
      const existing = check(await sb.from("finance_entries").select("id, gross_amount").eq("booking_id", b.id).eq("kind", "income").eq("status", "active"));
      const canBook = can("expenses.add");
      const f = form([
        { name: "amount", label: "Amount received (EUR)", type: "number", step: "0.01", min: 0, required: true },
        { name: "method", label: "Paid by", type: "select", options: [["cash", "Cash"], ["card", "Card terminal"], ["bank_transfer", "Bank transfer / invoice"], ["paypal", "PayPal / online"]] },
        canBook ? { name: "record", label: "Record as income in Finance", type: "checkbox", default: !existing.length, span: 2,
          hint: existing.length ? `Income already recorded: ${money(existing[0].gross_amount)}` : "Adds the ride to this month's income (19 % VAT)." } : null,
      ], { amount: b.price_amount, method: b.payment_method === "paypal" ? "paypal" : "cash" });
      const m = openDrawer({ title: onlyIncome ? "Record income" : `Complete ${b.booking_reference}`, body: f.el });
      m.setFooter([btn("Cancel", { onClick: m.close }), btn(onlyIncome ? "Save" : "Complete ride", { variant: "primary", ic: "check", onClick: (e) => {
        if (!f.validate()) return;
        busy(e.currentTarget, async () => {
          const v = f.values();
          try {
            if (!onlyIncome) {
              const patch = { status: "completed", completed_at: new Date().toISOString() };
              if (["cash_on_ride", "pending", "invoice"].includes(b.payment_status) && v.method !== "bank_transfer") Object.assign(patch, { payment_status: "paid", paid_at: new Date().toISOString(), payment_method: v.method });
              check(await sb.from("bookings").update(patch).eq("id", b.id));
            }
            if (v.record && v.amount > 0) {
              const cat = { cash: "income_cash", card: "income_card", bank_transfer: "income_invoice", paypal: "income_online" }[v.method] || "income_other";
              check(await sb.from("finance_entries").insert({
                entry_date: todayISO(), kind: "income", category_code: cat, vehicle_id: b.vehicle_id, driver_id: b.driver_id, booking_id: b.id,
                description: `Ride ${b.booking_reference} – ${b.customer_first_name} ${b.customer_last_name}`,
                payment_method: v.method, gross_amount: v.amount, vat_rate: 19, receipt_status: "not_required",
              }));
            }
            toast(onlyIncome ? "Income recorded" : "Ride completed"); m.close(); redraw(); load(); refreshBadges();
          } catch (err) { toastError(err); }
        });
      } })]);
    }

    /* ---------------- create / edit ---------------- */
    async function openEditor(b = null, after) {
      const [vList, dList] = await Promise.all([loadVehicles(), loadDrivers()]);
      const start = b ? isoToBerlinLocal(b.booking_start) : "";
      const minutes = b ? Math.max(15, Math.round((new Date(b.booking_end) - new Date(b.booking_start)) / 60000)) : 60;
      const f = form([
        { type: "section", label: "Customer" },
        { name: "customer_first_name", label: "First name", required: true },
        { name: "customer_last_name", label: "Last name", required: true },
        { name: "customer_phone", label: "Phone", type: "tel", required: true, placeholder: "0176 …" },
        { name: "customer_email", label: "E-mail", type: "email" },
        { name: "language", label: "SMS language", type: "select", options: [["de", "German"], ["en", "English"]] },
        { name: "source", label: "Booked via", type: "select", options: [["phone", "Phone"], ["email", "E-mail"], ["admin", "Office"], ["partner", "Partner"], ["website", "Website"]], default: "phone" },
        { type: "section", label: "Trip" },
        { name: "pickup_address", label: "Pickup address", required: true, span: 2 },
        { name: "destination_address", label: "Destination address", required: true, span: 2 },
        { name: "start", label: "Pickup date & time", type: "datetime", required: true },
        { name: "minutes", label: "Duration (minutes)", type: "number", min: 10, max: 1440, required: true },
        { name: "distance_km", label: "Distance (km)", type: "number", step: "0.1", min: 0 },
        { name: "service_type", label: "Service", type: "select", options: SERVICE_TYPES, default: "other" },
        { name: "passengers", label: "Passengers", type: "number", min: 1, max: 20 },
        { name: "luggage", label: "Bags", type: "number", min: 0, max: 20 },
        { name: "flight_number", label: "Flight number" },
        { name: "customer_notes", label: "Customer note", type: "textarea", rows: 2, span: 2 },
        { type: "section", label: "Vehicle, driver & price" },
        { name: "vehicle_id", label: "Vehicle", type: "select", placeholder: "– choose later –", options: vList.filter((v) => v.status !== "inactive").map((v) => [v.id, `${v.display_name} (${v.seats} seats)`]) },
        { name: "driver_id", label: "Driver", type: "select", placeholder: "– choose later –", options: dList.filter((x) => x.status === "active").map((x) => [x.id, x.display_name]) },
        { name: "price_amount", label: "Price (EUR, incl. VAT)", type: "number", step: "0.01", min: 0, required: true, hint: "Tip: leave empty and enter km + vehicle to calculate." },
        { name: "payment_status", label: "Payment", type: "select", options: PAYMENT_STATUSES.filter(([v]) => ["cash_on_ride", "paid", "invoice", "pending"].includes(v)), default: "cash_on_ride" },
        !b ? { name: "send_sms", label: "Send SMS confirmation to the customer", type: "checkbox", default: true, span: 2 } : null,
      ], b ? { ...b, start, minutes } : { passengers: 1, luggage: 0, minutes: 60, language: "de", source: "phone" });

      // price suggestion from km × vehicle rate
      const suggest = () => {
        const v = vList.find((x) => x.id === f.inputs.vehicle_id.input.value);
        const km = Number(f.inputs.distance_km.input.value);
        if (v && km > 0 && !f.inputs.price_amount.input.value) f.set("price_amount", Math.max(km * Number(v.price_per_km), Number(v.minimum_fare)).toFixed(2));
      };
      f.on("vehicle_id", "change", suggest); f.on("distance_km", "change", suggest);

      const d = openDrawer({ title: b ? `Edit ${b.booking_reference}` : "New booking", subtitle: b ? null : "For phone or office bookings. Website bookings arrive automatically.", body: f.el, wide: true });
      const save = btn(b ? "Save changes" : "Create booking", { variant: "primary", onClick: () => {
        if (!f.validate()) return;
        busy(save, async () => {
          try {
            const v = f.values();
            const startIso = berlinLocalToISO(v.start);
            const endIso = new Date(new Date(startIso).getTime() + v.minutes * 60000).toISOString();
            const veh = vList.find((x) => x.id === v.vehicle_id);
            const row = {
              customer_first_name: v.customer_first_name, customer_last_name: v.customer_last_name, customer_phone: v.customer_phone,
              customer_email: v.customer_email ? v.customer_email.toLowerCase() : null, language: v.language, source: v.source,
              pickup_address: v.pickup_address, destination_address: v.destination_address,
              booking_start: startIso, booking_end: endIso, duration_minutes: v.minutes, distance_km: v.distance_km,
              service_type: v.service_type, passengers: v.passengers || 1, luggage: v.luggage || 0,
              flight_number: v.flight_number ? v.flight_number.toUpperCase() : null, customer_notes: v.customer_notes,
              vehicle_id: v.vehicle_id, vehicle_name: veh ? veh.display_name : null, driver_id: v.driver_id,
              price_amount: v.price_amount, payment_status: v.payment_status,
            };
            if (veh && row.passengers > veh.seats) throw new Error(`${veh.display_name} has only ${veh.seats} seats.`);
            const warn = await conflicts({ ...row, id: b?.id }, row.vehicle_id, row.driver_id);
            if (warn && !(await confirmDialog({ title: "Possible double booking", message: warn + " Save anyway?", confirmText: "Save anyway" }))) return;
            let id = b?.id;
            if (b) {
              if (b.status === "confirmed" && row.driver_id) row.status = "assigned";
              check(await sb.from("bookings").update(row).eq("id", b.id));
              toast("Booking updated");
            } else {
              // one customer record per e-mail (optional)
              if (row.customer_email) {
                const c = check(await sb.from("customers").upsert({ email: row.customer_email, first_name: row.customer_first_name, last_name: row.customer_last_name, phone: row.customer_phone, language: row.language }, { onConflict: "email" }).select("id").single());
                row.customer_id = c.id;
              }
              Object.assign(row, { status: row.driver_id ? "assigned" : "confirmed", created_by: me().id, terms_accepted_at: null, timezone: "Europe/Berlin" });
              if (row.payment_status === "paid") Object.assign(row, { paid_at: new Date().toISOString() });
              const created = check(await sb.from("bookings").insert(row).select("id, booking_reference").single());
              id = created.id;
              toast(`Booking ${created.booking_reference} created`);
              if (v.send_sms) callFunction("booking-sms", { bookingId: id, template: "confirmation" }).then((r) => toast(`SMS sent to ${r.to}`)).catch((e) => toastError(new Error("SMS: " + e.message)));
            }
            d.close(); refreshBadges(); load();
            if (after) after(); else openDetail(id);
          } catch (e) { toastError(e); }
        });
      } });
      d.setFooter([btn("Cancel", { onClick: d.close }), save]);
    }

    await load();
    if (params.id) openDetail(params.id);
    if (params.new === "1" && editable) { const p = { ...params }; delete p.new; setParams(p); openEditor(); }
    const onLive = debounce(() => { if (!document.querySelector(".ov")) load(); }, 800);
    window.addEventListener("dd:bookings-changed", onLive);
    return () => window.removeEventListener("dd:bookings-changed", onLive);
  },
};
