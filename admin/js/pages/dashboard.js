// Dashboard: today at a glance, upcoming rides, things that need attention
import { sb, check } from "../core/supabase.js";
import { h, icon, card, empty, badge, btn, toastError, put } from "../core/ui.js";
import { money, time, weekdayDate, daysUntil, date, todayISO } from "../core/format.js";
import { me, can } from "../core/auth.js";

const ACTIVE = ["confirmed", "assigned", "on_the_way", "in_progress"];

function kpi(ic, labelText, value, sub, onClick) {
  return h("div", { class: "kpi" + (onClick ? " is-link" : ""), onClick },
    h("div", { class: "kpi-ic" }, icon(ic, 20)),
    h("div", {}, h("small", {}, labelText), h("strong", {}, value), sub ? h("span", { class: "sub" }, sub) : null));
}

function berlinDayBounds(offsetDays = 0) {
  const d = new Date(todayISO() + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  const iso = d.toISOString().slice(0, 10);
  // Berlin is UTC+1/+2 – use a generous window and filter precisely on the client
  return { iso, from: new Date(iso + "T00:00:00+02:00").toISOString(), to: new Date(iso + "T23:59:59+01:00").toISOString() };
}

export default {
  async render(root, { go }) {
    const u = me();
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    root.append(h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, `${greet}, ${u.first_name || u.username}`),
        h("p", { class: "muted" }, new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()))),
      h("div", { class: "page-actions" },
        can("bookings.edit") ? btn("New booking", { variant: "primary", ic: "plus", onClick: () => go("bookings", { new: "1" }) }) : null,
        can("expenses.add") ? btn("Add expense", { ic: "receipt", onClick: () => go("expense") }) : null)));

    const kpis = h("div", { class: "kpis" }, [1, 2, 3, 4].map(() => h("div", { class: "kpi" }, h("span", { class: "spin" }))));
    const upcomingBody = h("div", {}, h("div", { class: "loading" }, h("span", { class: "spin" })));
    const alertsBody = h("div", {}, h("div", { class: "loading" }, h("span", { class: "spin" })));
    root.append(kpis, h("div", { class: "grid grid-main" },
      card("Upcoming rides", upcomingBody, { cls: "flush", actions: btn("All bookings", { small: true, variant: "ghost", onClick: () => go("bookings") }) }),
      h("div", { class: "stack" },
        card("Needs attention", alertsBody, { cls: "flush" }),
        card("Quick actions", h("div", { class: "quick" },
          can("bookings.edit") ? btn("Phone booking", { ic: "phone", onClick: () => go("bookings", { new: "1" }) }) : null,
          can("expenses.add") ? btn("Fuel receipt", { ic: "receipt", onClick: () => go("expense", { category: "fuel" }) }) : null,
          can("fleet.edit") ? btn("Add vehicle", { ic: "car", onClick: () => go("vehicles", { new: "1" }) }) : null,
          can("drivers.edit") ? btn("Add driver", { ic: "users", onClick: () => go("drivers", { new: "1" }) }) : null,
          can("finance.view") ? btn("Monthly report", { ic: "chart", onClick: () => go("finance") }) : null,
          btn("Open website", { ic: "external", onClick: () => window.open("../index.html", "_blank") }))))));

    try {
      const now = new Date();
      const today = berlinDayBounds(0);
      const in7 = new Date(now.getTime() + 7 * 86400000).toISOString();
      const monthStart = todayISO().slice(0, 8) + "01";
      const [todayRows, upcoming, unassigned, monthRows, vehicles, drivers] = await Promise.all([
        sb.from("bookings").select("id, booking_start, status").gte("booking_start", today.from).lte("booking_start", today.to).in("status", [...ACTIVE, "completed"]),
        sb.from("bookings").select("id, booking_reference, booking_start, status, customer_first_name, customer_last_name, pickup_address, destination_address, vehicle_name, driver_id, price_amount, service_type")
          .gte("booking_start", new Date(now.getTime() - 3600000).toISOString()).in("status", ACTIVE).order("booking_start").limit(8),
        sb.from("bookings").select("id", { count: "exact", head: true }).eq("status", "confirmed").is("driver_id", null).gte("booking_start", now.toISOString()),
        sb.from("bookings").select("price_amount, status").gte("booking_start", new Date(monthStart + "T00:00:00+02:00").toISOString()).in("status", [...ACTIVE, "completed"]),
        sb.from("vehicles").select("id, display_name, plate_number, tuv_expiry, insurance_expiry, registration_expiry, next_service_date, status").neq("status", "inactive"),
        sb.from("drivers").select("id, display_name, licence_expiry, passenger_permit_expiry, medical_check_expiry, status").neq("status", "inactive"),
      ]);
      const tRows = check(todayRows).filter((b) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date(b.booking_start)) === today.iso);
      const up = check(upcoming);
      const unCount = check(unassigned).count ?? 0;
      const mRows = check(monthRows);
      const week = check(await sb.from("bookings").select("id", { count: "exact", head: true }).in("status", ACTIVE).gte("booking_start", now.toISOString()).lte("booking_start", in7)).count ?? 0;
      const revenue = mRows.reduce((s, r) => s + Number(r.price_amount || 0), 0);

      put(kpis, 
        kpi("calendar", "Rides today", String(tRows.length), `${tRows.filter((b) => b.status === "completed").length} completed`, () => go("bookings", { range: "today" })),
        kpi("route", "Next 7 days", String(week), "confirmed rides", () => go("bookings", { range: "week" })),
        kpi("users", "Without driver", String(unCount), unCount ? "assign a driver" : "all assigned", () => go("bookings", { status: "confirmed", nodriver: "1" })),
        kpi("euro", "Booked this month", money(revenue), `${mRows.length} rides`, can("finance.view") ? () => go("finance") : null));

      // upcoming list
      put(upcomingBody, up.length ? h("ul", { class: "list" }, up.map((b) => h("li", { class: "is-click", onClick: () => go("bookings", { id: b.id }) },
        h("div", { class: "when" }, h("b", {}, time(b.booking_start)), h("small", {}, weekdayDate(b.booking_start))),
        h("div", { class: "li-main" },
          h("strong", {}, `${b.customer_first_name} ${b.customer_last_name}`),
          h("small", {}, `${b.pickup_address} → ${b.destination_address}`),
          h("small", {}, [b.booking_reference, b.vehicle_name].filter(Boolean).join(" · "))),
        h("div", { class: "right" }, h("div", {}, money(b.price_amount)), b.driver_id ? badge(b.status) : badge("no driver", "amber")))))
        : empty("No upcoming rides", "New bookings from the website appear here automatically.", null, "calendar"));

      // alerts: documents expiring within 30 days (or overdue)
      const alerts = [];
      const add = (who, what, d, target) => {
        const n = daysUntil(d);
        if (n === null || n > 30) return;
        alerts.push({ who, what, d, n, target });
      };
      for (const v of check(vehicles)) {
        add(v.display_name + (v.plate_number ? ` (${v.plate_number})` : ""), "TÜV / HU", v.tuv_expiry, ["vehicles", { id: v.id }]);
        add(v.display_name, "Insurance", v.insurance_expiry, ["vehicles", { id: v.id }]);
        add(v.display_name, "Registration", v.registration_expiry, ["vehicles", { id: v.id }]);
        add(v.display_name, "Service due", v.next_service_date, ["vehicles", { id: v.id }]);
      }
      for (const d of check(drivers)) {
        add(d.display_name, "Driving licence", d.licence_expiry, ["drivers", { id: d.id }]);
        add(d.display_name, "Passenger permit (P-Schein)", d.passenger_permit_expiry, ["drivers", { id: d.id }]);
        add(d.display_name, "Medical check", d.medical_check_expiry, ["drivers", { id: d.id }]);
      }
      alerts.sort((a, b) => a.n - b.n);
      if (unCount) alerts.unshift({ who: `${unCount} upcoming ride${unCount > 1 ? "s" : ""}`, what: "No driver assigned yet", n: -1, target: ["bookings", { status: "confirmed", nodriver: "1" }], custom: true });
      put(alertsBody, alerts.length ? h("ul", { class: "list" }, alerts.slice(0, 8).map((a) => h("li", { class: `is-click alert-row ${a.n < 0 ? "is-red" : ""}`, onClick: () => go(...a.target) },
        icon("alert", 18),
        h("div", { class: "li-main" }, h("strong", {}, a.who), h("small", {}, a.custom ? a.what : `${a.what} · ${date(a.d)}`)),
        a.custom ? null : h("span", { class: "small " + (a.n < 0 ? "money-neg" : "muted") }, a.n < 0 ? `${-a.n} d overdue` : a.n === 0 ? "today" : `in ${a.n} d`))))
        : empty("All good", "No expiring documents or open tasks.", null, "check"));
    } catch (e) {
      toastError(e);
    }
  },
};
