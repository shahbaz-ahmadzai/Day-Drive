// Drivers: staff list, licences & permits, documents, vehicle assignment, rides
import { sb, check, uploadFile, signedFileUrl } from "../core/supabase.js";
import { h, icon, btn, badge, empty, card, toast, toastError, openDrawer, confirmDialog, form, busy, dl, tabs, table, debounce, put } from "../core/ui.js";
import { date, daysUntil, dateTime, money, todayISO, initials, label } from "../core/format.js";
import { invalidate, vehicles as loadVehicles } from "../core/data.js";
import { can } from "../core/auth.js";

const EMPLOYMENT = [["full_time", "Full-time"], ["part_time", "Part-time"], ["mini_job", "Mini-job"], ["freelance", "Freelance"], ["other", "Other"]];
const DOC_TYPES = [["driving_licence", "Driving licence"], ["passenger_permit", "Passenger permit (P-Schein)"], ["id_card", "ID card / passport"], ["medical", "Medical certificate"], ["contract", "Employment contract"], ["training", "Training certificate"], ["other", "Other"]];

function expiry(d) {
  const n = daysUntil(d);
  if (n === null) return h("span", { class: "muted" }, "–");
  const tone = n < 0 ? "red" : n <= 30 ? "amber" : "green";
  return h("span", { class: `badge badge-${tone}` }, date(d));
}

export default {
  async render(root, { params, setParams, go }) {
    const editable = can("drivers.edit");
    let q = "", status = params.status || "active";
    root.append(h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Drivers"), h("p", { class: "muted" }, "Chauffeurs, their licences, documents and vehicles.")),
      h("div", { class: "page-actions" }, editable ? btn("Add driver", { variant: "primary", ic: "plus", onClick: () => openEditor() }) : null)));

    const search = h("input", { class: "input", type: "search", placeholder: "Name, phone, employee no.…" });
    const statusSel = h("select", { class: "input" }, [["active", "Active"], ["on_leave", "On leave"], ["inactive", "Inactive"], ["all", "All"]].map(([v, t]) => h("option", { value: v, selected: v === status }, t)));
    root.append(h("div", { class: "toolbar" }, h("label", { class: "search" }, icon("search", 16), search), statusSel));
    const list = h("div", {});
    root.append(list);
    search.addEventListener("input", debounce(() => { q = search.value.trim().toLowerCase(); draw(); }, 200));
    statusSel.addEventListener("change", () => { status = statusSel.value; setParams({ status: status === "active" ? "" : status }); draw(); });

    let rows = [], current = {};
    async function load() {
      try {
        const [drv, asg] = await Promise.all([
          sb.from("drivers").select("*").order("first_name").then(check),
          sb.from("vehicle_assignments").select("driver_id, vehicles(display_name, plate_number)").is("ends_at", null).then(check),
        ]);
        rows = drv; current = Object.fromEntries(asg.map((a) => [a.driver_id, a.vehicles]));
        draw();
      } catch (e) { toastError(e); }
    }
    function draw() {
      const shown = rows.filter((d) => (status === "all" || d.status === status) &&
        (!q || [d.display_name, d.phone, d.email, d.employee_number].join(" ").toLowerCase().includes(q)));
      put(list, card(null, table({
        rows: shown, onRow: (d) => openDetail(d.id),
        emptyEl: empty(rows.length ? "No drivers match" : "No drivers yet", rows.length ? null : "Add your chauffeurs so you can assign them to rides.",
          !rows.length && editable ? btn("Add driver", { variant: "primary", ic: "plus", onClick: () => openEditor() }) : null, "users"),
        columns: [
          { label: "Driver", render: (d) => h("div", { class: "row", style: { flexWrap: "nowrap" } }, h("span", { class: "avatar" }, initials(d)), h("div", {}, h("strong", {}, d.display_name), h("small", {}, d.employee_number))) },
          { label: "Phone", render: (d) => (d.phone ? h("a", { href: `tel:${d.phone.replace(/\s/g, "")}` }, d.phone) : "–") },
          { label: "Vehicle", render: (d) => (current[d.id] ? h("div", {}, current[d.id].display_name, h("small", {}, current[d.id].plate_number || "")) : h("span", { class: "muted" }, "–")) },
          { label: "Licence", render: (d) => expiry(d.licence_expiry) },
          { label: "P-Schein", render: (d) => expiry(d.passenger_permit_expiry) },
          { label: "Status", render: (d) => badge(d.status) },
        ],
      }), { cls: "flush" }));
    }

    /* ---------------- detail ---------------- */
    async function openDetail(id, tab = "overview") {
      setParams({ status: status === "active" ? "" : status, id });
      const dr = openDrawer({ title: "Driver", body: h("div", { class: "loading" }, h("span", { class: "spin" })), wide: true, onClose: () => setParams({ status: status === "active" ? "" : status }) });
      const drawAll = async (activeTab = tab) => {
        try {
          const d = check(await sb.from("drivers").select("*").eq("id", id).single());
          dr.el.querySelector(".drawer-head h2").textContent = d.display_name;
          const content = h("div", {});
          const show = async (k) => {
            put(content, h("div", { class: "loading" }, h("span", { class: "spin" })));
            if (k === "overview") {
              put(content, h("div", { class: "grid grid-2" },
                h("div", {}, h("p", { class: "section-title" }, "Person"), dl([
                  ["Employee no.", d.employee_number], ["Status", badge(d.status)], ["Phone", d.phone ? h("a", { href: `tel:${d.phone.replace(/\s/g, "")}` }, d.phone) : null],
                  ["E-mail", d.email ? h("a", { href: `mailto:${d.email}` }, d.email) : null], ["Date of birth", date(d.date_of_birth)], ["Nationality", d.nationality],
                  ["Languages", (d.languages || []).join(", ")], ["Address", [d.street, [d.postal_code, d.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")],
                  ["Emergency contact", d.emergency_contact_name ? `${d.emergency_contact_name} ${d.emergency_contact_phone || ""}` : null],
                ])),
                h("div", {}, h("p", { class: "section-title" }, "Licences"), dl([
                  ["Driving licence", d.licence_number ? h("span", {}, h("span", { class: "mono" }, d.licence_number), " ", (d.licence_classes || []).join(", ")) : null],
                  ["Licence valid until", expiry(d.licence_expiry)],
                  ["P-Schein no.", d.passenger_permit_number], ["P-Schein valid until", expiry(d.passenger_permit_expiry)],
                  ["Medical check until", expiry(d.medical_check_expiry)],
                ]),
                h("p", { class: "section-title" }, "Employment"), dl([
                  ["Type", EMPLOYMENT.find((e) => e[0] === d.employment_type)?.[1]], ["Start", date(d.employment_start)], d.employment_end ? ["End", date(d.employment_end)] : null,
                  can("finance.view") || can("*") ? ["Tax ID", d.tax_id] : null, can("finance.view") ? ["Social security no.", d.social_security_number] : null, can("finance.view") ? ["IBAN", d.iban ? h("span", { class: "mono" }, d.iban) : null] : null,
                ]))),
                d.internal_notes ? h("div", { class: "note", style: { marginTop: "14px" } }, d.internal_notes) : null);
            } else if (k === "documents") {
              const docs = check(await sb.from("driver_documents").select("*").eq("driver_id", d.id).order("created_at", { ascending: false }));
              put(content, 
                editable ? h("div", { class: "row", style: { marginBottom: "12px" } }, btn("Upload document", { ic: "upload", small: true, onClick: () => addDocument(d, () => show("documents")) })) : null,
                table({ rows: docs, emptyEl: empty("No documents yet", "Upload licence, P-Schein, contract etc. They are stored privately.", null, "file"), columns: [
                  { label: "Document", render: (x) => h("div", {}, h("strong", {}, DOC_TYPES.find((t) => t[0] === x.document_type)?.[1] || x.document_type), h("small", {}, x.document_number || "")) },
                  { label: "Valid until", render: (x) => expiry(x.expiry_date) },
                  { label: "Added", render: (x) => date(x.created_at) },
                  { label: "", cls: "right", render: (x) => h("div", { class: "row", style: { justifyContent: "flex-end" } },
                    x.storage_path ? btn("Open", { small: true, ic: "eye", onClick: async () => { try { window.open(await signedFileUrl("driver-documents", x.storage_path, 120), "_blank"); } catch (e) { toastError(e); } } }) : null,
                    editable ? btn("", { small: true, ic: "x", variant: "ghost", title: "Delete", onClick: async () => {
                      if (!(await confirmDialog({ title: "Delete document?", confirmText: "Delete", danger: true }))) return;
                      try { if (x.storage_path) await sb.storage.from("driver-documents").remove([x.storage_path]); check(await sb.from("driver_documents").delete().eq("id", x.id)); toast("Document deleted"); show("documents"); } catch (e) { toastError(e); }
                    } }) : null) },
                ] }));
            } else if (k === "vehicle") {
              const as = check(await sb.from("vehicle_assignments").select("id, starts_at, ends_at, notes, vehicle_id, vehicles(display_name, plate_number)").eq("driver_id", d.id).order("starts_at", { ascending: false }).limit(20));
              const open = as.find((a) => !a.ends_at);
              put(content, 
                open ? h("div", { class: "note green", style: { marginBottom: "12px" } }, `Currently drives ${open.vehicles?.display_name} since ${date(open.starts_at)}.`)
                  : h("div", { class: "note", style: { marginBottom: "12px" } }, "No vehicle assigned at the moment."),
                editable ? h("div", { class: "row", style: { marginBottom: "12px" } },
                  btn(open ? "Change vehicle" : "Assign vehicle", { small: true, ic: "car", onClick: () => assignVehicle(d, open, () => { show("vehicle"); load(); }) }),
                  open ? btn("End assignment", { small: true, onClick: async () => {
                    try { check(await sb.from("vehicle_assignments").update({ ends_at: new Date().toISOString() }).eq("id", open.id)); toast("Assignment ended"); show("vehicle"); load(); } catch (e) { toastError(e); }
                  } }) : null) : null,
                table({ rows: as, emptyEl: h("span"), columns: [
                  { label: "Vehicle", render: (a) => h("div", {}, a.vehicles?.display_name, h("small", {}, a.vehicles?.plate_number || "")) },
                  { label: "From", render: (a) => date(a.starts_at) }, { label: "Until", render: (a) => (a.ends_at ? date(a.ends_at) : badge("current", "green")) }, { label: "Notes", key: "notes" }] }));
            } else if (k === "rides") {
              const rides = check(await sb.from("bookings").select("id, booking_reference, booking_start, customer_first_name, customer_last_name, price_amount, status, vehicle_name").eq("driver_id", d.id).order("booking_start", { ascending: false }).limit(40));
              const done = rides.filter((r) => r.status === "completed");
              put(content, 
                h("p", { class: "muted small", style: { marginBottom: "10px" } }, `${done.length} completed of the last ${rides.length} rides · ${money(done.reduce((s, r) => s + Number(r.price_amount), 0))}`),
                table({ rows: rides, onRow: (r) => { dr.close(); go("bookings", { id: r.id, range: "all", status: "all" }); }, emptyEl: empty("No rides yet", null, null, "calendar"), columns: [
                  { label: "Date", render: (r) => dateTime(r.booking_start) }, { label: "Ref", key: "booking_reference" }, { label: "Customer", render: (r) => `${r.customer_first_name} ${r.customer_last_name}` },
                  { label: "Vehicle", key: "vehicle_name" }, { label: "Status", render: (r) => badge(r.status) }] }));
            }
          };
          dr.setBody([tabs([["overview", "Overview"], ["documents", "Documents"], ["vehicle", "Vehicle"], ["rides", "Rides"]], show, activeTab), content]);
          show(activeTab);
          dr.setFooter(editable ? [h("span", { class: "spacer" }), btn("Edit", { variant: "primary", ic: "edit", onClick: () => openEditor(d, () => { drawAll(); load(); }) })] : [btn("Close", { onClick: dr.close })]);
        } catch (e) { toastError(e); dr.close(); }
      };
      drawAll();
    }

    function addDocument(d, after) {
      const f = form([
        { name: "document_type", label: "Type", type: "select", options: DOC_TYPES, required: true },
        { name: "document_number", label: "Number" },
        { name: "issue_date", label: "Issued", type: "date" },
        { name: "expiry_date", label: "Valid until", type: "date" },
        { name: "file", label: "File (PDF or photo)", type: "file", accept: "application/pdf,image/*", span: 2, required: true },
        { name: "notes", label: "Notes", type: "textarea", rows: 2, span: 2 },
        { name: "update_driver", label: "Also update the expiry date on the driver", type: "checkbox", default: true, span: 2 },
      ]);
      const m = openDrawer({ title: "Upload document", subtitle: d.display_name, body: f.el });
      m.setFooter([btn("Cancel", { onClick: m.close }), btn("Upload", { variant: "primary", ic: "upload", onClick: (e) => {
        if (!f.validate()) return;
        busy(e.currentTarget, async () => {
          try {
            const v = f.values();
            if (v.file.size > 10 * 1024 * 1024) throw new Error("The file is larger than 10 MB.");
            const path = await uploadFile("driver-documents", d.id, v.file);
            check(await sb.from("driver_documents").insert({ driver_id: d.id, document_type: v.document_type, document_number: v.document_number, issue_date: v.issue_date, expiry_date: v.expiry_date, storage_path: path, notes: v.notes }));
            if (v.update_driver && v.expiry_date) {
              const col = { driving_licence: "licence_expiry", passenger_permit: "passenger_permit_expiry", medical: "medical_check_expiry" }[v.document_type];
              const numCol = { driving_licence: "licence_number", passenger_permit: "passenger_permit_number" }[v.document_type];
              const patch = {};
              if (col) patch[col] = v.expiry_date;
              if (numCol && v.document_number) patch[numCol] = v.document_number;
              if (Object.keys(patch).length) check(await sb.from("drivers").update(patch).eq("id", d.id));
            }
            toast("Document uploaded"); m.close(); after(); load();
          } catch (err) { toastError(err); }
        });
      } })]);
    }

    async function assignVehicle(d, open, after) {
      const vList = (await loadVehicles()).filter((v) => v.status !== "inactive");
      const f = form([
        { name: "vehicle_id", label: "Vehicle", type: "select", required: true, placeholder: "Choose…", options: vList.map((v) => [v.id, `${v.display_name}${v.plate_number ? " · " + v.plate_number : ""}`]) },
        { name: "start_odometer_km", label: "Odometer at handover (km)", type: "number", min: 0 },
        { name: "notes", label: "Notes", type: "textarea", rows: 2, span: 2 },
      ]);
      const m = openDrawer({ title: "Assign vehicle", subtitle: d.display_name, body: f.el });
      m.setFooter([btn("Cancel", { onClick: m.close }), btn("Assign", { variant: "primary", onClick: (e) => {
        if (!f.validate()) return;
        busy(e.currentTarget, async () => {
          try {
            const v = f.values();
            const now = new Date().toISOString();
            if (open) check(await sb.from("vehicle_assignments").update({ ends_at: now }).eq("id", open.id));
            // the vehicle may still be with another driver → close that first
            check(await sb.from("vehicle_assignments").update({ ends_at: now }).eq("vehicle_id", v.vehicle_id).is("ends_at", null));
            check(await sb.from("vehicle_assignments").insert({ vehicle_id: v.vehicle_id, driver_id: d.id, starts_at: now, start_odometer_km: v.start_odometer_km, notes: v.notes }));
            toast("Vehicle assigned"); m.close(); after();
          } catch (err) { toastError(err); }
        });
      } })]);
    }

    /* ---------------- create / edit ---------------- */
    function openEditor(d = null, after) {
      const f = form([
        { type: "section", label: "Person" },
        { name: "first_name", label: "First name", required: true },
        { name: "last_name", label: "Last name", required: true },
        { name: "phone", label: "Mobile", type: "tel", required: true },
        { name: "email", label: "E-mail", type: "email" },
        { name: "date_of_birth", label: "Date of birth", type: "date" },
        { name: "nationality", label: "Nationality" },
        { name: "languages", label: "Languages", type: "tags", placeholder: "German, English, Dari", span: 2, hint: "Separate with commas" },
        { name: "street", label: "Street & no." },
        { name: "postal_code", label: "Postcode" },
        { name: "city", label: "City" },
        { name: "country", label: "Country", default: "Germany" },
        { name: "emergency_contact_name", label: "Emergency contact" },
        { name: "emergency_contact_phone", label: "Emergency phone", type: "tel" },
        { type: "section", label: "Licences" },
        { name: "licence_number", label: "Driving licence no." },
        { name: "licence_classes", label: "Classes", type: "tags", placeholder: "B, BE" },
        { name: "licence_expiry", label: "Licence valid until", type: "date" },
        { name: "passenger_permit_number", label: "P-Schein no." },
        { name: "passenger_permit_expiry", label: "P-Schein valid until", type: "date" },
        { name: "medical_check_expiry", label: "Medical check valid until", type: "date" },
        { type: "section", label: "Employment" },
        { name: "status", label: "Status", type: "select", options: [["active", "Active"], ["on_leave", "On leave"], ["inactive", "Inactive"]], default: "active" },
        { name: "employment_type", label: "Employment", type: "select", options: EMPLOYMENT, default: "full_time" },
        { name: "employment_start", label: "Start date", type: "date" },
        { name: "employment_end", label: "End date", type: "date" },
        { name: "tax_id", label: "Tax ID (Steuer-ID)" },
        { name: "social_security_number", label: "Social security no." },
        { name: "iban", label: "IBAN", span: 2 },
        { name: "internal_notes", label: "Internal notes", type: "textarea", rows: 2, span: 2 },
      ], d || { country: "Germany", employment_start: todayISO() });
      const dr = openDrawer({ title: d ? `Edit ${d.display_name}` : "Add driver", body: f.el, wide: true });
      const save = btn(d ? "Save" : "Add driver", { variant: "primary", onClick: () => {
        if (!f.validate()) return;
        busy(save, async () => {
          try {
            const v = f.values();
            if (v.email) v.email = v.email.toLowerCase();
            if (v.iban) v.iban = v.iban.replace(/\s/g, "").toUpperCase();
            let id = d?.id;
            if (d) check(await sb.from("drivers").update(v).eq("id", d.id));
            else id = check(await sb.from("drivers").insert(v).select("id").single()).id;
            invalidate("drivers"); toast(d ? "Driver saved" : "Driver added"); dr.close(); load();
            if (after) after(); else openDetail(id);
          } catch (e) { toastError(e); }
        });
      } });
      dr.setFooter([btn("Cancel", { onClick: dr.close }), save]);
    }

    await load();
    if (params.id) openDetail(params.id);
    if (params.new === "1" && editable) { setParams({}); openEditor(); }
  },
};
