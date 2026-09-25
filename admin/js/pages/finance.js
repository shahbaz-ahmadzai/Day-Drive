// Finance: monthly overview, all entries (GoBD – cancel instead of delete), recurring costs, month closing, export
import { sb, check, signedFileUrl, uploadFile } from "../core/supabase.js";
import { h, icon, btn, badge, empty, card, toast, toastError, openDrawer, confirmDialog, form, busy, dl, tabs, table, iconBtn, downloadText, toCSV, clear, put } from "../core/ui.js";
import { money, date, dateTime, num, todayISO, label } from "../core/format.js";
import { categories as loadCats, vehicles as loadVehicles, drivers as loadDrivers, PAYMENT_METHODS, invalidate } from "../core/data.js";
import { can, me } from "../core/auth.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
const monthStart = (y, m) => `${y}-${pad(m)}-01`;
const nextMonth = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);
const prevMonth = (y, m) => (m === 1 ? [y - 1, 12] : [y, m - 1]);

export default {
  async render(root, { params, setParams, go }) {
    const [ty, tm] = todayISO().split("-").map(Number);
    let [year, month] = params.m ? params.m.split("-").map(Number) : [ty, tm];
    let tab = params.tab || "overview";
    const editable = can("finance.edit");

    const monthLabel = h("strong", {});
    const lockBtn = h("span");
    root.append(h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Finance"), h("p", { class: "muted" }, "Income, costs and VAT per month – ready for your tax advisor.")),
      h("div", { class: "page-actions" },
        h("div", { class: "month-nav" }, iconBtn("chevronLeft", "Previous month", () => { [year, month] = prevMonth(year, month); refresh(); }), monthLabel,
          iconBtn("chevronRight", "Next month", () => { [year, month] = nextMonth(year, month); refresh(); })),
        btn("Export", { ic: "download", onClick: exportMonth }),
        can("expenses.add") ? btn("Add expense", { ic: "receipt", onClick: () => go("expense") }) : null,
        editable ? btn("Add income", { variant: "primary", ic: "plus", onClick: () => addIncome() }) : null)));
    const tabBar = tabs([["overview", "Overview"], ["entries", "Entries"], ["recurring", "Recurring costs"]], (k) => { tab = k; sync(); drawTab(); }, tab);
    const status = h("div", {});
    const content = h("div", {});
    root.append(tabBar, status, content);

    let cats = [], vehicles = [], drivers = [], entries = [], locked = false;
    const catName = (c) => cats.find((x) => x.code === c)?.name_en || label(c);
    const sync = () => setParams({ m: `${year}-${pad(month)}`, tab: tab === "overview" ? "" : tab });

    async function refresh() {
      sync();
      monthLabel.textContent = `${MONTHS[month - 1]} ${year}`;
      put(content, h("div", { class: "loading" }, h("span", { class: "spin" })));
      try {
        const [y2, m2] = nextMonth(year, month);
        [cats, vehicles, drivers] = await Promise.all([loadCats(), loadVehicles(), loadDrivers()]);
        const [e, l] = await Promise.all([
          sb.from("finance_entries").select("*").gte("entry_date", monthStart(year, month)).lt("entry_date", monthStart(y2, m2)).order("entry_date", { ascending: false }).order("entry_no", { ascending: false }).then(check),
          sb.from("finance_month_locks").select("*").eq("period", monthStart(year, month)).maybeSingle().then(check),
        ]);
        entries = e; locked = !!l;
        put(status, locked ? h("div", { class: "note blue", style: { marginBottom: "14px" } }, icon("lock", 15), ` This month was closed on ${dateTime(l.locked_at)}. Entries can no longer be added.`) : "");
        drawTab();
      } catch (err) { toastError(err); }
    }

    function drawTab() {
      if (tab === "overview") drawOverview();
      else if (tab === "entries") drawEntries();
      else drawRecurring();
    }

    /* ---------------- overview ---------------- */
    async function drawOverview() {
      const act = entries.filter((e) => e.status === "active");
      const sum = (arr, k = "gross_amount") => arr.reduce((s, e) => s + Number(e[k] || 0), 0);
      const inc = act.filter((e) => e.kind === "income"), exp = act.filter((e) => e.kind === "expense");
      const vatOut = sum(inc, "vat_amount"), vatIn = sum(exp, "vat_amount");
      const missing = act.filter((e) => e.receipt_status === "missing");
      const byCat = (arr) => Object.entries(arr.reduce((o, e) => ((o[e.category_code] = (o[e.category_code] || 0) + Number(e.gross_amount)), o), {})).sort((a, b) => b[1] - a[1]);
      const bars = (pairs) => {
        const max = Math.max(1, ...pairs.map((p) => p[1]));
        return pairs.length ? h("div", { class: "bars" }, pairs.map(([c, v]) => h("div", { class: "bar-row" }, h("span", {}, catName(c)), h("div", { class: "bar" }, h("b", { style: { width: `${(v / max) * 100}%` } })), h("strong", {}, money(v)))))
          : h("p", { class: "muted small" }, "No entries this month.");
      };
      // per vehicle
      const perVehicle = vehicles.map((v) => {
        const i = sum(inc.filter((e) => e.vehicle_id === v.id)), x = sum(exp.filter((e) => e.vehicle_id === v.id));
        return { v, i, x, r: i - x };
      }).filter((r) => r.i || r.x);

      put(content, 
        h("div", { class: "kpis" },
          kpi("Income", money(sum(inc)), `net ${money(sum(inc, "net_amount"))}`, "money-pos"),
          kpi("Expenses", money(sum(exp)), `net ${money(sum(exp, "net_amount"))}`, "money-neg"),
          kpi("Result (net)", money(sum(inc, "net_amount") - sum(exp, "net_amount")), "before income tax"),
          kpi("VAT to pay", money(vatOut - vatIn), `${money(vatOut)} collected − ${money(vatIn)} paid`)),
        missing.length ? h("div", { class: "note red", style: { marginBottom: "18px", cursor: "pointer" }, onClick: () => { tab = "entries"; tabBar.querySelectorAll(".tab")[1].click(); } },
          icon("alert", 15), ` ${missing.length} expense${missing.length > 1 ? "s" : ""} without receipt – click to see them.`) : null,
        h("div", { class: "grid grid-2" },
          card("Income by category", bars(byCat(inc))),
          card("Expenses by category", bars(byCat(exp)))),
        h("div", { class: "grid grid-main", style: { marginTop: "18px" } },
          card("Last 6 months", h("div", {}, h("div", { class: "chart-cols", id: "chart6" }, h("div", { class: "loading" }, h("span", { class: "spin" }))),
            h("div", { class: "legend", style: { marginTop: "10px" } }, h("span", {}, h("i", { style: { background: "var(--gold)" } }), "Income"), h("span", {}, h("i", { style: { background: "#9aa4b1" } }), "Expenses")))),
          card("Per vehicle", perVehicle.length ? table({ rows: perVehicle, columns: [
            { label: "Vehicle", render: (r) => r.v.display_name },
            { label: "Income", cls: "right", render: (r) => money(r.i) },
            { label: "Costs", cls: "right", render: (r) => money(r.x) },
            { label: "Result", cls: "right", render: (r) => h("strong", { class: r.r >= 0 ? "money-pos" : "money-neg" }, money(r.r)) }] })
            : h("p", { class: "muted small" }, "No vehicle entries this month."), { cls: perVehicle.length ? "flush" : "" })),
        can("finance.edit") && ["owner", "admin"].includes(me().role) && !locked ? h("div", { class: "row", style: { marginTop: "18px", justifyContent: "flex-end" } },
          btn("Close month", { ic: "lock", onClick: lockMonth })) : null);

      // 6-month chart
      const months = []; let [y, m] = [year, month];
      for (let i = 0; i < 6; i++) { months.unshift([y, m]); [y, m] = prevMonth(y, m); }
      const [ny, nm] = nextMonth(year, month);
      try {
        const rows = check(await sb.from("finance_entries").select("entry_date, kind, gross_amount").eq("status", "active").gte("entry_date", monthStart(...months[0])).lt("entry_date", monthStart(ny, nm)));
        const agg = months.map(([yy, mm]) => {
          const key = `${yy}-${pad(mm)}`;
          const r = rows.filter((x) => x.entry_date.startsWith(key));
          return { key, mm, i: r.filter((x) => x.kind === "income").reduce((s, x) => s + Number(x.gross_amount), 0), x: r.filter((x) => x.kind === "expense").reduce((s, x) => s + Number(x.gross_amount), 0) };
        });
        const max = Math.max(1, ...agg.map((a) => Math.max(a.i, a.x)));
        const el = document.getElementById("chart6");
        if (el) put(el, ...agg.map((a) => h("div", { class: "chart-col", title: `${MONTHS[a.mm - 1]}: income ${money(a.i)}, expenses ${money(a.x)}` },
          h("div", { class: "pair" }, h("b", { class: "inc", style: { height: `${(a.i / max) * 100}%` } }), h("b", { class: "exp", style: { height: `${(a.x / max) * 100}%` } })),
          h("small", {}, MONTHS[a.mm - 1].slice(0, 3)))));
      } catch (e) { /* chart is optional */ }
    }
    function kpi(t, v, sub, cls = "") {
      return h("div", { class: "kpi" }, h("div", {}, h("small", {}, t), h("strong", { class: cls }, v), sub ? h("span", { class: "sub" }, sub) : null));
    }

    /* ---------------- entries ---------------- */
    function drawEntries() {
      let kind = "all", receipt = "all", showCancelled = false;
      const kindSel = h("select", { class: "input" }, [["all", "Income & expenses"], ["income", "Income"], ["expense", "Expenses"]].map(([v, t]) => h("option", { value: v }, t)));
      const recSel = h("select", { class: "input" }, [["all", "All receipts"], ["missing", "Receipt missing"], ["attached", "Receipt attached"]].map(([v, t]) => h("option", { value: v }, t)));
      const canc = h("input", { type: "checkbox" });
      const list = h("div", {});
      const draw = () => {
        const rows = entries.filter((e) => (kind === "all" || e.kind === kind) && (receipt === "all" || e.receipt_status === receipt) && (showCancelled || e.status === "active"));
        put(list, card(null, table({
          rows, onRow: openEntry, rowClass: (e) => (e.status === "cancelled" ? "is-muted" : ""),
          emptyEl: empty("No entries", "Nothing matches the filters for this month.", null, "receipt"),
          columns: [
            { label: "No.", render: (e) => h("span", { class: "mono" }, e.entry_no) },
            { label: "Date", render: (e) => date(e.entry_date) },
            { label: "Category", render: (e) => h("div", {}, catName(e.category_code), h("small", {}, vehicles.find((v) => v.id === e.vehicle_id)?.display_name || "")) },
            { label: "Description", render: (e) => h("div", {}, e.description || "–", h("small", {}, e.vendor || "")) },
            { label: "Receipt", render: (e) => badge(e.receipt_status) },
            { label: "Amount", cls: "right", render: (e) => h("div", {}, h("strong", { class: e.kind === "income" ? "money-pos" : "money-neg" }, (e.kind === "income" ? "+" : "−") + money(e.gross_amount)), h("small", {}, `VAT ${num(e.vat_rate, 0)} %`)) },
            { label: "", render: (e) => (e.status === "cancelled" ? badge("cancelled") : "") },
          ],
        }), { cls: "flush" }));
      };
      kindSel.addEventListener("change", () => { kind = kindSel.value; draw(); });
      recSel.addEventListener("change", () => { receipt = recSel.value; draw(); });
      canc.addEventListener("change", () => { showCancelled = canc.checked; draw(); });
      put(content, h("div", { class: "toolbar" }, kindSel, recSel, h("label", { class: "check" }, canc, h("span", {}, "Show cancelled"))), list);
      draw();
    }

    async function openEntry(e) {
      const v = vehicles.find((x) => x.id === e.vehicle_id), d = drivers.find((x) => x.id === e.driver_id);
      const dr = openDrawer({ title: `${e.kind === "income" ? "Income" : "Expense"} #${e.entry_no}`, subtitle: catName(e.category_code) });
      const receiptBox = h("div", {});
      const drawReceipt = async () => {
        if (e.receipt_path) {
          const isImg = /\.(jpe?g|png|webp|gif|heic)$/i.test(e.receipt_path);
          try {
            const url = await signedFileUrl("receipts", e.receipt_path, 300);
            put(receiptBox, isImg ? h("a", { href: url, target: "_blank", rel: "noopener" }, h("img", { src: url, alt: "Receipt", style: { maxHeight: "320px", borderRadius: "8px", border: "1px solid var(--line)" } }))
              : h("a", { class: "btn btn-sm", href: url, target: "_blank", rel: "noopener" }, icon("file", 15), "Open receipt"));
          } catch (err) { put(receiptBox, h("span", { class: "muted" }, err.message)); }
        } else if (e.receipt_status === "missing" && e.status === "active" && can("expenses.add")) {
          const inp = h("input", { type: "file", class: "input", accept: "image/*,application/pdf" });
          put(receiptBox, h("div", { class: "note red", style: { marginBottom: "8px" } }, "Receipt is missing."), inp,
            h("div", { style: { marginTop: "8px" } }, btn("Attach receipt", { small: true, ic: "upload", onClick: (ev) => busy(ev.currentTarget, async () => {
              try {
                const file = inp.files?.[0]; if (!file) throw new Error("Choose a file first.");
                const path = await uploadFile("receipts", e.entry_date.slice(0, 7), file);
                check(await sb.from("finance_entries").update({ receipt_path: path, receipt_status: "attached" }).eq("id", e.id));
                Object.assign(e, { receipt_path: path, receipt_status: "attached" }); toast("Receipt attached"); drawReceipt(); refresh();
              } catch (err) { toastError(err); }
            }) })));
        } else put(receiptBox, h("span", { class: "muted" }, e.receipt_status === "not_required" ? "No receipt needed" + (e.no_receipt_reason ? ` – ${e.no_receipt_reason}` : "") : "–"));
      };
      dr.setBody(h("div", {},
        e.status === "cancelled" ? h("div", { class: "note red", style: { marginBottom: "14px" } }, `Cancelled ${dateTime(e.cancelled_at)}: ${e.cancelled_reason}`) : null,
        dl([
          ["Date", date(e.entry_date)], ["Category", catName(e.category_code)], ["Description", e.description], ["Vendor / customer", e.vendor], ["Invoice no.", e.invoice_number],
          ["Gross", h("strong", {}, money(e.gross_amount))], ["Net", money(e.net_amount)], [`VAT ${num(e.vat_rate, 0)} %`, money(e.vat_amount)],
          ["Paid by", PAYMENT_METHODS.find((p) => p[0] === e.payment_method)?.[1]], v ? ["Vehicle", v.display_name] : null, d ? ["Driver", d.display_name] : null,
          e.odometer_km ? ["Odometer", `${num(e.odometer_km, 0)} km`] : null, e.fuel_liters ? ["Litres", num(e.fuel_liters)] : null,
          e.booking_id ? ["Booking", h("a", { href: "#", onClick: (ev) => { ev.preventDefault(); dr.close(); go("bookings", { id: e.booking_id, status: "all", range: "all" }); } }, "Open booking")] : null,
          e.recurring_id ? ["Recurring", "Created from a recurring cost"] : null,
          ["Entered", dateTime(e.created_at)],
        ]),
        h("p", { class: "section-title" }, "Receipt"), receiptBox,
        h("p", { class: "muted small", style: { marginTop: "18px" } }, "Saved entries can't be edited or deleted (GoBD). To correct a mistake, cancel the entry with a reason and add a new one.")));
      drawReceipt();
      dr.setFooter(e.status === "active" && editable ? [btn("Cancel entry", { variant: "ghost", ic: "x", onClick: async () => {
        const reason = await confirmDialog({ title: `Cancel entry #${e.entry_no}?`, message: "The entry stays in the books but no longer counts.", confirmText: "Cancel entry", danger: true, input: { label: "Reason", required: true, placeholder: "e.g. entered twice" } });
        if (!reason) return;
        try { check(await sb.from("finance_entries").update({ status: "cancelled", cancelled_reason: reason }).eq("id", e.id)); toast("Entry cancelled"); dr.close(); refresh(); } catch (err) { toastError(err); }
      } }), h("span", { class: "spacer" }), btn("Close", { onClick: dr.close })] : [btn("Close", { onClick: dr.close })]);
    }

    function addIncome() {
      const incCats = cats.filter((c) => c.kind === "income");
      const f = form([
        { name: "entry_date", label: "Date", type: "date", required: true },
        { name: "category_code", label: "Category", type: "select", required: true, options: incCats.map((c) => [c.code, c.name_en]) },
        { name: "gross_amount", label: "Amount incl. VAT (EUR)", type: "number", step: "0.01", min: 0.01, required: true },
        { name: "vat_rate", label: "VAT %", type: "select", options: [["19", "19 %"], ["7", "7 %"], ["0", "0 %"]], default: "19" },
        { name: "payment_method", label: "Received by", type: "select", options: PAYMENT_METHODS, default: "cash" },
        { name: "vehicle_id", label: "Vehicle", type: "select", placeholder: "–", options: vehicles.map((v) => [v.id, v.display_name]) },
        { name: "description", label: "Description", required: true, span: 2, placeholder: "e.g. Airport transfer Mr. Müller" },
        { name: "vendor", label: "Customer / payer" },
        { name: "invoice_number", label: "Invoice no." },
      ], { entry_date: todayISO() });
      f.on("category_code", "change", () => { const c = incCats.find((x) => x.code === f.inputs.category_code.input.value); if (c) f.set("vat_rate", String(Number(c.default_vat_rate))); });
      const dr = openDrawer({ title: "Add income", subtitle: "For rides paid outside the booking system, tips, partner payouts…", body: f.el });
      dr.setFooter([btn("Cancel", { onClick: dr.close }), btn("Save income", { variant: "primary", onClick: (ev) => {
        if (!f.validate()) return;
        busy(ev.currentTarget, async () => {
          try {
            const v = f.values();
            check(await sb.from("finance_entries").insert({ ...v, kind: "income", vat_rate: Number(v.vat_rate), receipt_status: "not_required" }));
            toast("Income saved"); dr.close(); refresh();
          } catch (err) { toastError(err); }
        });
      } })]);
    }

    async function lockMonth() {
      const ok = await confirmDialog({ title: `Close ${MONTHS[month - 1]} ${year}?`, message: "After closing, no new entries can be added for this month. Do this after sending the month to your tax advisor. This can't be undone here.", confirmText: "Close month", danger: true });
      if (!ok) return;
      try { check(await sb.from("finance_month_locks").insert({ period: monthStart(year, month), locked_by: me().id })); toast("Month closed"); refresh(); } catch (e) { toastError(e); }
    }

    function exportMonth() {
      const rows = entries.filter((e) => e.status === "active");
      const cols = [
        { label: "No.", value: (e) => e.entry_no }, { label: "Date", value: (e) => date(e.entry_date) }, { label: "Type", value: (e) => (e.kind === "income" ? "Income" : "Expense") },
        { label: "Category", value: (e) => catName(e.category_code) }, { label: "Account SKR03", value: (e) => cats.find((c) => c.code === e.category_code)?.account_skr03 || "" },
        { label: "Description", value: (e) => e.description }, { label: "Vendor/customer", value: (e) => e.vendor }, { label: "Invoice no.", value: (e) => e.invoice_number },
        { label: "Vehicle", value: (e) => vehicles.find((v) => v.id === e.vehicle_id)?.display_name || "" },
        { label: "Gross", value: (e) => num(e.gross_amount) }, { label: "VAT %", value: (e) => num(e.vat_rate, 0) }, { label: "VAT", value: (e) => num(e.vat_amount) }, { label: "Net", value: (e) => num(e.net_amount) },
        { label: "Paid by", value: (e) => e.payment_method }, { label: "Receipt", value: (e) => e.receipt_status },
      ];
      if (!rows.length) return toast("No entries to export for this month", "error");
      downloadText(`day-drive-finance-${year}-${pad(month)}.csv`, toCSV(rows, cols));
    }

    /* ---------------- recurring ---------------- */
    async function drawRecurring() {
      try {
        const rec = check(await sb.from("finance_recurring_costs").select("*").order("is_active", { ascending: false }).order("day_of_month"));
        const total = rec.filter((r) => r.is_active).reduce((s, r) => s + Number(r.gross_amount), 0);
        put(content, 
          h("div", { class: "toolbar" },
            h("span", { class: "muted" }, `${rec.filter((r) => r.is_active).length} active · ${money(total)} per month`), h("span", { class: "spacer" }),
            editable && !locked ? btn(`Create entries for ${MONTHS[month - 1]}`, { ic: "refresh", onClick: (e) => busy(e.currentTarget, async () => {
              try { const { data, error } = await sb.rpc("finance_generate_recurring", { p_year: year, p_month: month }); if (error) throw error; toast(data ? `${data} entr${data > 1 ? "ies" : "y"} created` : "Nothing new – already created"); refresh(); } catch (err) { toastError(err); }
            }) }) : null,
            editable ? btn("Add recurring cost", { variant: "primary", ic: "plus", onClick: () => editRecurring() }) : null),
          card(null, table({
            rows: rec, onRow: editable ? (r) => editRecurring(r) : null, rowClass: (r) => (r.is_active ? "" : "is-muted"),
            emptyEl: empty("No recurring costs", "Leasing, insurance, rent, software… Add them once and create the entries every month with one click.", null, "refresh"),
            columns: [
              { label: "Description", render: (r) => h("div", {}, h("strong", {}, r.description), h("small", {}, catName(r.category_code))) },
              { label: "Vehicle", render: (r) => vehicles.find((v) => v.id === r.vehicle_id)?.display_name || "–" },
              { label: "Day", render: (r) => `${r.day_of_month}.` },
              { label: "Period", render: (r) => `${date(r.start_date)} – ${r.end_date ? date(r.end_date) : "open"}` },
              { label: "Amount", cls: "right", render: (r) => h("strong", {}, money(r.gross_amount)) },
              { label: "", render: (r) => badge(r.is_active ? "active" : "inactive") },
            ],
          }), { cls: "flush" }));
      } catch (e) { toastError(e); }
    }
    function editRecurring(r = null) {
      const expCats = cats.filter((c) => c.kind === "expense");
      const f = form([
        { name: "description", label: "Description", required: true, span: 2, placeholder: "e.g. Leasing E-Class" },
        { name: "category_code", label: "Category", type: "select", required: true, options: expCats.map((c) => [c.code, c.name_en]) },
        { name: "vehicle_id", label: "Vehicle", type: "select", placeholder: "– company cost –", options: vehicles.map((v) => [v.id, v.display_name]) },
        { name: "gross_amount", label: "Amount incl. VAT (EUR)", type: "number", step: "0.01", min: 0.01, required: true },
        { name: "vat_rate", label: "VAT %", type: "select", options: [["19", "19 %"], ["7", "7 %"], ["0", "0 %"]], default: "19" },
        { name: "day_of_month", label: "Day of month", type: "number", min: 1, max: 28, required: true },
        { name: "payment_method", label: "Paid by", type: "select", options: PAYMENT_METHODS, default: "direct_debit" },
        { name: "vendor", label: "Vendor" },
        { name: "start_date", label: "Start", type: "date", required: true },
        { name: "end_date", label: "End (optional)", type: "date" },
        { name: "is_active", label: "Active", type: "checkbox", default: true },
      ], r ? { ...r, vat_rate: String(Number(r.vat_rate)) } : { day_of_month: 1, start_date: monthStart(year, month) });
      f.on("category_code", "change", () => { const c = expCats.find((x) => x.code === f.inputs.category_code.input.value); if (c) f.set("vat_rate", String(Number(c.default_vat_rate))); });
      const dr = openDrawer({ title: r ? "Edit recurring cost" : "Add recurring cost", body: f.el });
      dr.setFooter([btn("Cancel", { onClick: dr.close }), btn("Save", { variant: "primary", onClick: (ev) => {
        if (!f.validate()) return;
        busy(ev.currentTarget, async () => {
          try {
            const v = { ...f.values() }; v.vat_rate = Number(v.vat_rate);
            if (r) check(await sb.from("finance_recurring_costs").update(v).eq("id", r.id)); else check(await sb.from("finance_recurring_costs").insert(v));
            toast("Saved"); dr.close(); drawRecurring();
          } catch (err) { toastError(err); }
        });
      } })]);
    }

    refresh();
  },
};
