// Add expense: quick form (works well on the phone) – category, vehicle, amount, receipt photo
import { sb, check, uploadFile } from "../core/supabase.js";
import { h, icon, btn, card, toast, toastError, form, busy, table, badge, empty, put } from "../core/ui.js";
import { money, date, todayISO, num } from "../core/format.js";
import { categories as loadCats, vehicles as loadVehicles, drivers as loadDrivers, PAYMENT_METHODS, invalidate } from "../core/data.js";
import { can } from "../core/auth.js";

const QUICK = ["fuel", "car_wash", "parking", "tolls", "service", "parts", "insurance", "phone_internet", "office_supplies", "company_other"];
const QUICK_ICON = { fuel: "wallet", car_wash: "star", parking: "pin", tolls: "route", service: "settings", parts: "sliders", insurance: "shield", phone_internet: "phone", office_supplies: "file", company_other: "more" };

export default {
  async render(root, { params, go }) {
    const [cats, vehicles, drivers] = await Promise.all([loadCats(), loadVehicles(), loadDrivers()]);
    const expCats = cats.filter((c) => c.kind === "expense");
    let category = params.category && expCats.some((c) => c.code === params.category) ? params.category : null;

    root.append(h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Add expense"), h("p", { class: "muted" }, "Fuel, parking, workshop… take a photo of the receipt and you're done.")),
      can("finance.view") ? h("div", { class: "page-actions" }, btn("Go to Finance", { ic: "chart", onClick: () => go("finance", { tab: "entries" }) })) : null));

    const tiles = h("div", { class: "quick", style: { gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", marginBottom: "18px" } });
    const drawTiles = () => put(tiles, ...QUICK.map((code) => {
      const c = expCats.find((x) => x.code === code);
      if (!c) return null;
      return h("button", { type: "button", class: "btn" + (category === code ? " btn-primary" : ""), onClick: () => { category = code; f.set("category_code", code); applyCategory(); drawTiles(); } },
        icon(QUICK_ICON[code] || "receipt", 17), h("span", {}, c.name_en.split(" / ")[0]));
    }).filter(Boolean));

    const f = form([
      { name: "category_code", label: "Category", type: "select", required: true, placeholder: "Choose…", options: expCats.map((c) => [c.code, c.name_en]) },
      { name: "entry_date", label: "Date", type: "date", required: true, max: todayISO() },
      { name: "vehicle_id", label: "Vehicle", type: "select", placeholder: "– company cost –", options: vehicles.filter((v) => v.status !== "inactive").map((v) => [v.id, `${v.display_name}${v.plate_number ? " · " + v.plate_number : ""}`]) },
      { name: "driver_id", label: "Driver", type: "select", placeholder: "–", options: drivers.filter((d) => d.status === "active").map((d) => [d.id, d.display_name]) },
      { name: "gross_amount", label: "Amount incl. VAT (EUR)", type: "number", step: "0.01", min: 0.01, required: true, inputmode: "decimal" },
      { name: "vat_rate", label: "VAT %", type: "select", options: [["19", "19 %"], ["7", "7 %"], ["0", "0 % (insurance, tax, fees…)"]], default: "19" },
      { name: "fuel_liters", label: "Litres / kWh", type: "number", step: "0.01", min: 0, inputmode: "decimal" },
      { name: "odometer_km", label: "Odometer (km)", type: "number", min: 0, inputmode: "numeric" },
      { name: "vendor", label: "Where / vendor", placeholder: "e.g. Aral Hanauer Landstr." },
      { name: "payment_method", label: "Paid by", type: "select", options: PAYMENT_METHODS, default: "card" },
      { name: "invoice_number", label: "Receipt / invoice no." },
      { name: "description", label: "Note", placeholder: "optional" },
      { name: "receipt", label: "Receipt photo or PDF", type: "file", accept: "image/*,application/pdf", span: 2, hint: "On the phone this opens the camera." },
      { name: "no_receipt", label: "I have no receipt", type: "checkbox", span: 2 },
      { name: "no_receipt_reason", label: "Why is there no receipt?", span: 2, placeholder: "e.g. parking machine gave no receipt" },
    ], { entry_date: todayISO(), category_code: category, vehicle_id: params.vehicle || null });

    const fuelFields = ["fuel_liters", "odometer_km"].map((n) => f.inputs[n].input.closest(".field"));
    const reasonField = f.inputs.no_receipt_reason.input.closest(".field");
    function applyCategory() {
      const code = f.inputs.category_code.input.value;
      const c = expCats.find((x) => x.code === code);
      if (c) f.set("vat_rate", String(Number(c.default_vat_rate)));
      fuelFields.forEach((el) => (el.hidden = code !== "fuel"));
    }
    const applyReceipt = () => { reasonField.hidden = !f.inputs.no_receipt.input.checked; };
    f.on("category_code", "change", () => { category = f.inputs.category_code.input.value; applyCategory(); drawTiles(); });
    f.on("no_receipt", "change", applyReceipt);
    applyCategory(); applyReceipt(); drawTiles();

    // live VAT preview
    const preview = h("p", { class: "muted small", style: { marginTop: "-4px" } });
    const updPreview = () => {
      const g = Number(f.inputs.gross_amount.input.value), r = Number(f.inputs.vat_rate.input.value);
      preview.textContent = g > 0 ? `Net ${money(g / (1 + r / 100))} + VAT ${money(g - g / (1 + r / 100))}` : "";
    };
    f.on("gross_amount", "input", updPreview); f.on("vat_rate", "change", updPreview);
    f.inputs.gross_amount.input.closest(".field").append(preview);

    const save = btn("Save expense", { variant: "primary", ic: "check" });
    const again = h("div", {});
    save.addEventListener("click", () => {
      if (!f.validate()) return;
      const v = f.values();
      if (!v.receipt && !v.no_receipt) { toastError(new Error("Add the receipt photo, or tick “I have no receipt”.")); return; }
      if (v.no_receipt && !v.no_receipt_reason) { toastError(new Error("Please write why there is no receipt.")); f.inputs.no_receipt_reason.input.focus(); return; }
      busy(save, async () => {
        try {
          let receipt_path = null;
          if (v.receipt) {
            if (v.receipt.size > 12 * 1024 * 1024) throw new Error("The file is larger than 12 MB.");
            receipt_path = await uploadFile("receipts", v.entry_date.slice(0, 7), v.receipt);
          }
          const c = expCats.find((x) => x.code === v.category_code);
          const row = {
            entry_date: v.entry_date, kind: "expense", category_code: v.category_code, vehicle_id: v.vehicle_id, driver_id: v.driver_id,
            description: v.description || c?.name_en || "Expense", vendor: v.vendor, invoice_number: v.invoice_number, payment_method: v.payment_method,
            gross_amount: v.gross_amount, vat_rate: Number(v.vat_rate), odometer_km: v.odometer_km, fuel_liters: v.fuel_liters,
            receipt_path, receipt_status: receipt_path ? "attached" : "missing", no_receipt_reason: v.no_receipt ? v.no_receipt_reason : null,
          };
          const { error } = await sb.from("finance_entries").insert(row);
          if (error) throw new Error(error.message);
          // keep the vehicle's odometer up to date
          if (v.vehicle_id && v.odometer_km) {
            const veh = vehicles.find((x) => x.id === v.vehicle_id);
            if (!veh?.odometer_km || v.odometer_km > veh.odometer_km) {
              await sb.from("vehicles").update({ odometer_km: v.odometer_km }).eq("id", v.vehicle_id);
              invalidate("vehicles");
            }
          }
          toast(`Expense saved: ${money(v.gross_amount)}`);
          put(again, h("div", { class: "note green", style: { marginTop: "14px" } }, icon("check", 15), ` Saved ${c?.name_en || ""} ${money(v.gross_amount)}${v.vehicle_id ? " for " + (vehicles.find((x) => x.id === v.vehicle_id)?.display_name || "") : ""}. You can add the next one.`));
          for (const n of ["gross_amount", "fuel_liters", "odometer_km", "vendor", "invoice_number", "description", "no_receipt_reason"]) f.set(n, "");
          f.inputs.receipt.input.value = ""; f.set("no_receipt", false); applyReceipt(); updPreview();
          loadRecent();
        } catch (e) { toastError(e); }
      });
    });

    const recentBox = h("div", {});
    root.append(h("div", { class: "grid grid-main" },
      card("New expense", h("div", {}, tiles, f.el, h("div", { class: "form-actions", style: { marginTop: "16px" } }, save), again)),
      can("finance.view") ? card("Recent expenses", recentBox, { cls: "flush" }) : card("Tip", h("p", { class: "muted small" }, "Always photograph the receipt right away. Receipts are kept for 10 years for the tax office."))));

    async function loadRecent() {
      if (!can("finance.view")) return;
      try {
        const rows = check(await sb.from("finance_entries").select("id, entry_date, category_code, gross_amount, receipt_status, vehicle_id").eq("kind", "expense").eq("status", "active").order("created_at", { ascending: false }).limit(8));
        put(recentBox, table({ rows, onRow: () => go("finance", { tab: "entries" }), emptyEl: empty("No expenses yet", null, null, "receipt"), columns: [
          { label: "Date", render: (r) => date(r.entry_date) },
          { label: "Category", render: (r) => h("div", {}, expCats.find((c) => c.code === r.category_code)?.name_en || r.category_code, h("small", {}, vehicles.find((v) => v.id === r.vehicle_id)?.display_name || "")) },
          { label: "Amount", cls: "right", render: (r) => money(r.gross_amount) },
          { label: "Receipt", render: (r) => badge(r.receipt_status) },
        ] }));
      } catch (e) { toastError(e); }
    }
    loadRecent();
  },
};
