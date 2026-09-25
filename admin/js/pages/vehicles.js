// Vehicles: fleet overview, prices shown on the website, documents & service dates
import { sb, check, publicFileUrl, uploadFile } from "../core/supabase.js";
import { h, icon, btn, badge, empty, card, toast, toastError, openDrawer, confirmDialog, form, busy, clear, dl, tabs, table, put } from "../core/ui.js";
import { money, date, daysUntil, num, plain, todayISO, dateTime } from "../core/format.js";
import { invalidate } from "../core/data.js";
import { can } from "../core/auth.js";

const CATS = [["vip", "VIP / First class"], ["business", "Business"], ["comfort", "Comfort"], ["family", "Family"], ["van", "Van / group"], ["other", "Other"]];
const FUEL = [["petrol", "Petrol"], ["diesel", "Diesel"], ["hybrid", "Hybrid"], ["plugin_hybrid", "Plug-in hybrid"], ["electric", "Electric"], ["other", "Other"]];

function expiryChip(labelText, d) {
  const n = daysUntil(d);
  if (n === null) return null;
  const tone = n < 0 ? "red" : n <= 30 ? "amber" : "grey";
  return h("span", { class: `badge badge-${tone}` }, `${labelText} ${date(d)}`);
}

export default {
  async render(root, { params, setParams, go }) {
    const editable = can("fleet.edit");
    let filter = params.filter || "all";
    root.append(h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Vehicles"), h("p", { class: "muted" }, "Your fleet, website prices and important dates.")),
      h("div", { class: "page-actions" }, editable ? btn("Add vehicle", { variant: "primary", ic: "plus", onClick: () => openEditor() }) : null)));

    const seg = h("div", { class: "seg" });
    [["all", "All"], ["active", "Active"], ["maintenance", "In workshop"], ["inactive", "Inactive"]].forEach(([k, t]) =>
      seg.append(h("button", { type: "button", class: k === filter ? "is-active" : "", onClick: (e) => {
        filter = k; seg.querySelectorAll("button").forEach((b) => b.classList.remove("is-active")); e.currentTarget.classList.add("is-active");
        setParams({ filter: k === "all" ? "" : k }); draw();
      } }, t)));
    root.append(h("div", { class: "toolbar" }, seg));
    const grid = h("div", {});
    root.append(grid);

    let rows = [];
    async function load() {
      put(grid, h("div", { class: "loading" }, h("span", { class: "spin" })));
      try { rows = check(await sb.from("vehicles").select("*").order("sort_order").order("display_name")); draw(); }
      catch (e) { toastError(e); }
    }
    function draw() {
      const shown = rows.filter((v) => filter === "all" || v.status === filter);
      if (!shown.length) {
        put(grid, card(null, empty("No vehicles here", "Add your first vehicle to show it on the website.", editable ? btn("Add vehicle", { variant: "primary", ic: "plus", onClick: () => openEditor() }) : null, "car")));
        return;
      }
      put(grid, h("div", { class: "v-grid" }, shown.map((v) => {
        const img = publicFileUrl("vehicle-images", v.image_path);
        return h("article", { class: "v-card", onClick: () => openDetail(v.id) },
          h("div", { class: "v-img" }, img ? h("img", { src: img, alt: v.display_name, loading: "lazy" }) : icon("car", 42)),
          h("div", { class: "v-body" },
            h("div", { class: "row between" }, h("h3", {}, v.display_name), badge(v.status)),
            h("div", { class: "v-meta" },
              h("span", { class: "chip" }, v.category_label || CATS.find((c) => c[0] === v.category)?.[1] || v.category),
              h("span", { class: "chip" }, `${v.seats} seats`),
              v.plate_number ? h("span", { class: "chip mono" }, v.plate_number) : null,
              v.online_booking ? h("span", { class: "chip" }, icon("check", 12), "Website") : h("span", { class: "chip" }, "Not online")),
            h("div", { class: "v-meta" }, expiryChip("TÜV", v.tuv_expiry), expiryChip("Insurance", v.insurance_expiry), expiryChip("Service", v.next_service_date))),
          h("div", { class: "v-foot" }, h("span", { class: "muted" }, `min. ${money(v.minimum_fare)}`), h("strong", {}, `${money(v.price_per_km)} / km`)));
      })));
    }

    /* ---------------- detail ---------------- */
    async function openDetail(id) {
      setParams({ filter: filter === "all" ? "" : filter, id });
      const d = openDrawer({ title: "Vehicle", body: h("div", { class: "loading" }, h("span", { class: "spin" })), wide: true, onClose: () => setParams({ filter: filter === "all" ? "" : filter }) });
      const draw = async (tab = "overview") => {
        try {
          const v = check(await sb.from("vehicles").select("*").eq("id", id).single());
          d.el.querySelector(".drawer-head h2").textContent = v.display_name;
          const body = h("div", {});
          const content = h("div", {});
          body.append(tabs([["overview", "Overview"], ["rides", "Rides"], ["costs", "Costs"], ["drivers", "Drivers"]], (k) => show(k), tab), content);
          const show = async (k) => {
            put(content, h("div", { class: "loading" }, h("span", { class: "spin" })));
            if (k === "overview") {
              const img = publicFileUrl("vehicle-images", v.image_path);
              put(content, 
                h("div", { class: "img-preview" }, img ? h("img", { src: img, alt: "" }) : icon("car", 48)),
                h("div", { class: "grid grid-2" },
                  h("div", {}, h("p", { class: "section-title" }, "Vehicle"), dl([
                    ["Status", badge(v.status)], ["Plate", v.plate_number], ["Fleet no.", v.fleet_number], ["Year", v.year], ["Colour", v.color],
                    ["Fuel", FUEL.find((f) => f[0] === v.fuel_type)?.[1]], ["Gearbox", v.transmission], ["Seats / bags", `${v.seats} seats · ${v.luggage_large} large · ${v.luggage_small} small`],
                    ["Features", [v.air_conditioning && "A/C", v.child_seat_available && "Child seat", v.wifi && "Wi-Fi", v.wheelchair_accessible && "Wheelchair"].filter(Boolean).join(", ")],
                    ["VIN", v.vin ? h("span", { class: "mono" }, v.vin) : null],
                  ])),
                  h("div", {}, h("p", { class: "section-title" }, "Website & prices"), dl([
                    ["Online booking", v.online_booking ? badge("active", "green") : badge("off", "grey")],
                    ["Category", v.category_label || v.category], ["Price per km", money(v.price_per_km)], ["Minimum fare", money(v.minimum_fare)],
                    ["Airport fee", money(v.airport_fee)], ["Night surcharge", `${plain(v.night_surcharge_pct)} %`],
                  ]),
                  h("p", { class: "section-title" }, "Dates & service"), dl([
                    ["TÜV / HU", v.tuv_expiry ? h("span", {}, date(v.tuv_expiry), " ", expiryChip("", v.tuv_expiry)) : null],
                    ["Insurance", v.insurance_expiry ? `${date(v.insurance_expiry)}${v.insurance_company ? " · " + v.insurance_company : ""}` : v.insurance_company],
                    ["Registration", date(v.registration_expiry)], ["Odometer", v.odometer_km ? `${plain(v.odometer_km)} km` : null],
                    ["Last service", v.last_service_date ? `${date(v.last_service_date)}${v.last_service_km ? " · " + plain(v.last_service_km) + " km" : ""}` : null],
                    ["Next service", v.next_service_date ? date(v.next_service_date) : v.service_interval_km && v.last_service_km ? `at ${plain(Number(v.last_service_km) + Number(v.service_interval_km))} km` : null],
                    ["Ownership", v.ownership_type],
                  ]))),
                v.description_en || v.description_de ? h("div", {}, h("p", { class: "section-title" }, "Website text"), h("p", { class: "small" }, h("strong", {}, "EN: "), v.description_en || "–"), h("p", { class: "small", style: { marginTop: "6px" } }, h("strong", {}, "DE: "), v.description_de || "–")) : null,
                v.internal_notes ? h("div", { class: "note", style: { marginTop: "14px" } }, v.internal_notes) : null);
            } else if (k === "rides") {
              const rides = check(await sb.from("bookings").select("id, booking_reference, booking_start, customer_first_name, customer_last_name, price_amount, status").eq("vehicle_id", v.id).order("booking_start", { ascending: false }).limit(30));
              put(content, table({ rows: rides, onRow: (r) => { d.close(); go("bookings", { id: r.id, range: "all", status: "all" }); }, emptyEl: empty("No rides yet", null, null, "calendar"), columns: [
                { label: "Date", render: (r) => dateTime(r.booking_start) }, { label: "Ref", key: "booking_reference" },
                { label: "Customer", render: (r) => `${r.customer_first_name} ${r.customer_last_name}` }, { label: "Price", cls: "right", render: (r) => money(r.price_amount) }, { label: "Status", render: (r) => badge(r.status) }] }));
            } else if (k === "costs") {
              if (!can("finance.view")) { put(content, h("p", { class: "muted" }, "Only finance roles can see costs.")); return; }
              const year = todayISO().slice(0, 4);
              const entries = check(await sb.from("finance_entries").select("entry_date, kind, category_code, description, gross_amount").eq("vehicle_id", v.id).eq("status", "active").gte("entry_date", `${year}-01-01`).order("entry_date", { ascending: false }));
              const inc = entries.filter((e) => e.kind === "income").reduce((s, e) => s + Number(e.gross_amount), 0);
              const exp = entries.filter((e) => e.kind === "expense").reduce((s, e) => s + Number(e.gross_amount), 0);
              put(content, 
                h("div", { class: "kpis", style: { gridTemplateColumns: "repeat(3,1fr)" } },
                  h("div", { class: "kpi" }, h("div", {}, h("small", {}, `Income ${year}`), h("strong", { class: "money-pos" }, money(inc)))),
                  h("div", { class: "kpi" }, h("div", {}, h("small", {}, `Costs ${year}`), h("strong", { class: "money-neg" }, money(exp)))),
                  h("div", { class: "kpi" }, h("div", {}, h("small", {}, "Result"), h("strong", {}, money(inc - exp))))),
                table({ rows: entries, emptyEl: empty("No entries this year", null, btn("Add expense", { ic: "receipt", onClick: () => { d.close(); go("expense", { vehicle: v.id }); } }), "receipt"), columns: [
                  { label: "Date", render: (e) => date(e.entry_date) }, { label: "Category", render: (e) => e.category_code.replace(/_/g, " ") }, { label: "Description", key: "description" },
                  { label: "Amount", cls: "right", render: (e) => h("span", { class: e.kind === "income" ? "money-pos" : "money-neg" }, (e.kind === "income" ? "+" : "−") + money(e.gross_amount)) }] }));
            } else if (k === "drivers") {
              const as = check(await sb.from("vehicle_assignments").select("id, starts_at, ends_at, notes, driver_id, drivers(display_name)").eq("vehicle_id", v.id).order("starts_at", { ascending: false }).limit(20));
              put(content, 
                h("p", { class: "muted small", style: { marginBottom: "10px" } }, "Which driver usually drives this vehicle. Manage assignments on the driver's page."),
                table({ rows: as, emptyEl: empty("No driver assigned", null, null, "users"), columns: [
                  { label: "Driver", render: (a) => a.drivers?.display_name }, { label: "From", render: (a) => date(a.starts_at) }, { label: "Until", render: (a) => (a.ends_at ? date(a.ends_at) : badge("current", "green")) }, { label: "Notes", key: "notes" }] }));
            }
          };
          d.setBody(body);
          show(tab);
          d.setFooter(editable ? [
            btn(v.online_booking ? "Hide from website" : "Show on website", { ic: "external", onClick: (e) => busy(e.currentTarget, async () => {
              try { check(await sb.from("vehicles").update({ online_booking: !v.online_booking }).eq("id", v.id)); invalidate("vehicles"); toast(v.online_booking ? "Hidden from website" : "Now bookable online"); draw(); load(); } catch (err) { toastError(err); }
            }) }),
            h("span", { class: "spacer" }),
            btn("Edit", { variant: "primary", ic: "edit", onClick: () => openEditor(v, () => { draw(); load(); }) }),
          ] : [btn("Close", { onClick: d.close })]);
        } catch (e) { toastError(e); d.close(); }
      };
      draw();
    }

    /* ---------------- create / edit ---------------- */
    function openEditor(v = null, after) {
      const f = form([
        { type: "section", label: "Vehicle" },
        { name: "brand", label: "Brand", required: true, placeholder: "Mercedes-Benz" },
        { name: "model", label: "Model", required: true, placeholder: "E-Class" },
        { name: "year", label: "Year", type: "number", min: 1990, max: 2100 },
        { name: "color", label: "Colour" },
        { name: "plate_number", label: "Number plate", placeholder: "F-DD 123" },
        { name: "fleet_number", label: "Fleet number", placeholder: "optional" },
        { name: "vin", label: "VIN", span: 2 },
        { name: "fuel_type", label: "Fuel", type: "select", options: FUEL, default: "diesel" },
        { name: "transmission", label: "Gearbox", type: "select", options: [["automatic", "Automatic"], ["manual", "Manual"]], default: "automatic" },
        { name: "seats", label: "Passenger seats", type: "number", min: 1, max: 20, required: true },
        { name: "doors", label: "Doors", type: "number", min: 2, max: 6 },
        { name: "luggage_large", label: "Large bags", type: "number", min: 0, max: 20 },
        { name: "luggage_small", label: "Small bags", type: "number", min: 0, max: 20 },
        { name: "air_conditioning", label: "Air conditioning", type: "checkbox", default: true },
        { name: "child_seat_available", label: "Child seat available", type: "checkbox" },
        { name: "wifi", label: "Wi-Fi", type: "checkbox" },
        { name: "wheelchair_accessible", label: "Wheelchair accessible", type: "checkbox" },

        { type: "section", label: "Website & prices", hint: "The website calculates the price: km × price per km (at least the minimum fare) + extras." },
        { name: "category", label: "Category", type: "select", options: CATS, default: "comfort" },
        { name: "category_label", label: "Category name on website", placeholder: "e.g. Business Class" },
        { name: "price_per_km", label: "Price per km (EUR)", type: "number", step: "0.01", min: 0, required: true },
        { name: "minimum_fare", label: "Minimum fare (EUR)", type: "number", step: "0.01", min: 0, required: true },
        { name: "airport_fee", label: "Airport fee (EUR)", type: "number", step: "0.01", min: 0 },
        { name: "night_surcharge_pct", label: "Night surcharge (%)", type: "number", step: "1", min: 0, max: 100 },
        { name: "online_booking", label: "Bookable on the website", type: "checkbox", default: true },
        { name: "sort_order", label: "Order on website", type: "number", min: 0, hint: "Lower numbers first" },
        { name: "image", label: "Photo", type: "file", accept: "image/*", span: 2, hint: v?.image_path ? "Leave empty to keep the current photo. Wide photos (16:9) look best." : "Wide photos (16:9) look best." },
        { name: "description_en", label: "Description (English)", type: "textarea", rows: 2 },
        { name: "description_de", label: "Description (German)", type: "textarea", rows: 2 },

        { type: "section", label: "Status, documents & service" },
        { name: "status", label: "Status", type: "select", options: [["active", "Active"], ["maintenance", "In workshop"], ["inactive", "Inactive"]], default: "active" },
        { name: "ownership_type", label: "Ownership", type: "select", options: [["owned", "Owned"], ["leased", "Leased"], ["financed", "Financed"], ["rented", "Rented"]], default: "owned" },
        { name: "tuv_expiry", label: "TÜV / HU due", type: "date" },
        { name: "registration_expiry", label: "Registration valid until", type: "date" },
        { name: "insurance_company", label: "Insurance company" },
        { name: "insurance_number", label: "Policy number" },
        { name: "insurance_expiry", label: "Insurance valid until", type: "date" },
        { name: "odometer_km", label: "Odometer (km)", type: "number", min: 0 },
        { name: "last_service_date", label: "Last service", type: "date" },
        { name: "last_service_km", label: "Last service at (km)", type: "number", min: 0 },
        { name: "service_interval_km", label: "Service interval (km)", type: "number", min: 0 },
        { name: "next_service_date", label: "Next service date", type: "date" },
        { name: "internal_notes", label: "Internal notes", type: "textarea", rows: 2, span: 2 },
      ], v || { seats: 4, luggage_large: 2, luggage_small: 2, doors: 4, airport_fee: 0, night_surcharge_pct: 0, sort_order: 10 });

      const d = openDrawer({ title: v ? `Edit ${v.display_name}` : "Add vehicle", body: f.el, wide: true });
      const foot = [];
      if (v) foot.push(btn("Delete", { variant: "ghost", ic: "x", onClick: async () => {
        if (!(await confirmDialog({ title: `Delete ${v.display_name}?`, message: "Only possible if the vehicle has no rides or costs. Otherwise set it to Inactive.", confirmText: "Delete", danger: true }))) return;
        try { check(await sb.from("vehicles").delete().eq("id", v.id)); invalidate("vehicles"); toast("Vehicle deleted"); d.close(); document.querySelectorAll(".ov-drawer").forEach((x) => x.remove()); load(); }
        catch (e) { toastError(/foreign key|violates/i.test(e.message) ? new Error("This vehicle has rides or costs. Set the status to Inactive instead.") : e); }
      } }), h("span", { class: "spacer" }));
      const save = btn(v ? "Save" : "Add vehicle", { variant: "primary", onClick: () => {
        if (!f.validate()) return;
        busy(save, async () => {
          try {
            const val = f.values();
            const file = val.image; delete val.image;
            for (const k of ["luggage_large", "luggage_small", "airport_fee", "night_surcharge_pct", "sort_order"]) if (val[k] === null) val[k] = 0;
            if (file) {
              if (file.size > 6 * 1024 * 1024) throw new Error("The photo is larger than 6 MB.");
              val.image_path = await uploadFile("vehicle-images", "vehicles", file);
            }
            let id = v?.id;
            if (v) check(await sb.from("vehicles").update(val).eq("id", v.id));
            else id = check(await sb.from("vehicles").insert(val).select("id").single()).id;
            invalidate("vehicles"); toast(v ? "Vehicle saved" : "Vehicle added"); d.close(); load();
            if (after) after(); else openDetail(id);
          } catch (e) { toastError(e); }
        });
      } });
      foot.push(btn("Cancel", { onClick: d.close }), save);
      d.setFooter(foot);
    }

    await load();
    if (params.id) openDetail(params.id);
    if (params.new === "1" && editable) { setParams({}); openEditor(); }
  },
};
