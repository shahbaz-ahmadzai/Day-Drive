// Customers: contact details, rides, monthly rides and the prepaid balance (deposits, refunds, statement)
import { sb, check } from "../core/supabase.js";
import { h, icon, btn, badge, empty, card, toast, toastError, openDrawer, form, busy, dl, tabs, table, put, pageHeader, debounce } from "../core/ui.js";
import { money, date, dateTime, todayISO, fullName, relative } from "../core/format.js";
import { can } from "../core/auth.js";

const KIND = { deposit: ["Deposit", "green"], ride: ["Monthly ride", "blue"], extra_ride: ["Extra ride", "violet"], no_show: ["No-show", "red"], refund: ["Refund", "amber"], adjustment: ["Correction", "grey"] };
const METHODS = [["bank_transfer", "Bank transfer"], ["cash", "Cash"], ["card", "Card"], ["paypal", "PayPal"], ["other", "Other"]];
const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw new Error(error.message); return data; };

export default {
  async render(root, { params, setParams, go }) {
    const finance = can("finance.edit") || can("*");
    let q = params.q || "", onlyBalance = params.balance === "1", rows = [], balances = {};
    root.append(pageHeader("Customers", "Everyone who booked. Monthly-ride customers pay in advance – record their deposits here."));
    const search = h("input", { class: "input", type: "search", placeholder: "Name, phone, e-mail…", value: q });
    const only = h("label", { class: "check" }, h("input", { type: "checkbox", checked: onlyBalance }), h("span", {}, "Only customers with a balance"));
    root.append(h("div", { class: "toolbar" }, h("label", { class: "search" }, icon("search", 16), search), only));
    const list = h("div");
    root.append(list);
    search.addEventListener("input", debounce(() => { q = search.value.trim(); setParams({ q, balance: onlyBalance ? "1" : "" }); draw(); }, 200));
    only.querySelector("input").addEventListener("change", (e) => { onlyBalance = e.target.checked; setParams({ q, balance: onlyBalance ? "1" : "" }); draw(); });

    async function load() {
      try {
        const [cs, led] = await Promise.all([
          sb.from("customers").select("id, first_name, last_name, email, phone, company_name, language, created_at, auth_user_id").order("created_at", { ascending: false }).limit(1000).then(check),
          can("finance.view") || can("*") ? sb.from("customer_ledger").select("customer_id, amount").limit(10000).then(check).catch(() => []) : Promise.resolve([]),
        ]);
        balances = {};
        for (const l of led) balances[l.customer_id] = (balances[l.customer_id] || 0) + Number(l.amount);
        rows = cs; draw();
      } catch (e) { toastError(e); }
    }
    function draw() {
      const ql = q.toLowerCase();
      const shown = rows.filter((c) => (!onlyBalance || balances[c.id]) && (!ql || [c.first_name, c.last_name, c.email, c.phone, c.company_name].join(" ").toLowerCase().includes(ql)));
      put(list, card(null, table({
        rows: shown.slice(0, 300), onRow: (c) => openDetail(c.id),
        emptyEl: empty(rows.length ? "No customers match" : "No customers yet", "Customers are created automatically with their first booking.", null, "users"),
        columns: [
          { label: "Customer", render: (c) => h("div", {}, h("strong", {}, fullName(c)), h("small", {}, c.company_name || c.email || "")) },
          { label: "Phone", render: (c) => (c.phone ? h("a", { href: `tel:${c.phone.replace(/\s/g, "")}` }, c.phone) : "–") },
          { label: "Since", render: (c) => date(c.created_at) },
          { label: "My Day Drive", render: (c) => (c.auth_user_id ? badge("logged in once", "green") : h("span", { class: "muted" }, "–")) },
          { label: "Balance", cls: "right", render: (c) => (balances[c.id] ? h("strong", { class: balances[c.id] < 0 ? "money-neg" : "" }, money(balances[c.id])) : h("span", { class: "muted" }, "–")) },
        ],
      }), { cls: "flush", sub: shown.length > 300 ? `Showing 300 of ${shown.length} – use the search.` : null }));
    }

    async function openDetail(id, tab = "overview") {
      setParams({ q, balance: onlyBalance ? "1" : "", id });
      const dr = openDrawer({ title: "Customer", body: h("div", { class: "loading" }, h("span", { class: "spin" })), wide: true, onClose: () => setParams({ q, balance: onlyBalance ? "1" : "" }) });
      const drawAll = async (active = tab) => {
        try {
          const [c, bal] = await Promise.all([sb.from("customers").select("*").eq("id", id).single().then(check), rpc("admin_customer_balance", { p_customer_id: id }).catch(() => null)]);
          dr.el.querySelector(".drawer-head h2").textContent = fullName(c);
          const content = h("div");
          const show = async (k) => {
            put(content, h("div", { class: "loading" }, h("span", { class: "spin" })));
            if (k === "overview") {
              put(content, h("div", { class: "grid grid-2" },
                h("div", {}, h("p", { class: "section-title" }, "Contact"), dl([
                  ["Phone", c.phone ? h("a", { href: `tel:${c.phone.replace(/\s/g, "")}` }, c.phone) : null], ["E-mail", c.email ? h("a", { href: `mailto:${c.email}` }, c.email) : null],
                  ["Company", c.company_name], ["Language", c.language], ["Customer since", date(c.created_at)], ["My Day Drive", c.auth_user_id ? "has logged in" : "not yet"],
                ]), c.notes ? h("div", { class: "note", style: { marginTop: "10px" } }, c.notes) : null),
                h("div", {}, h("p", { class: "section-title" }, "Balance"),
                  bal ? h("div", { class: "kpis", style: { gridTemplateColumns: "repeat(3,1fr)" } },
                    h("div", { class: "kpi" }, h("div", {}, h("small", {}, "Balance"), h("strong", {}, money(bal.balance)))),
                    h("div", { class: "kpi" }, h("div", {}, h("small", {}, "Reserved"), h("strong", {}, money(bal.held)))),
                    h("div", { class: "kpi" }, h("div", {}, h("small", {}, "Available"), h("strong", { class: bal.available < 0 ? "money-neg" : "money-pos" }, money(bal.available))))) : h("p", { class: "muted" }, "–"),
                  h("p", { class: "muted small", style: { marginTop: "8px" } }, "Reserved = planned rides paid from the balance that are not driven yet."),
                  finance ? h("div", { class: "row", style: { marginTop: "12px" } },
                    btn("Record deposit", { variant: "primary", ic: "plus", small: true, onClick: () => deposit(c, () => { drawAll("ledger"); load(); }) }),
                    btn("Refund", { small: true, onClick: () => refund(c, bal, () => { drawAll("ledger"); load(); }) })) : null)));
            } else if (k === "ledger") {
              const led = check(await sb.from("customer_ledger").select("*, bookings(booking_reference, booking_start)").eq("customer_id", c.id).order("created_at", { ascending: false }).limit(300));
              let run = led.reduce((s, l) => s + Number(l.amount), 0);
              put(content, table({ rows: led, emptyEl: empty("No entries yet", "Deposits and rides paid from the balance appear here.", null, "wallet"), columns: [
                { label: "No.", render: (l) => h("span", { class: "mono" }, l.entry_no) },
                { label: "Date", render: (l) => dateTime(l.created_at) },
                { label: "What", render: (l) => h("div", {}, badge(KIND[l.kind]?.[0] || l.kind, KIND[l.kind]?.[1]), h("small", {}, [l.bookings?.booking_reference, l.reference, l.method, l.note].filter(Boolean).join(" · "))) },
                { label: "Amount", cls: "right", render: (l) => h("strong", { class: Number(l.amount) < 0 ? "money-neg" : "money-pos" }, money(l.amount)) },
                { label: "Balance", cls: "right", render: (l) => { const v = run; run -= Number(l.amount); return money(v); } },
              ] }), h("p", { class: "muted small", style: { marginTop: "8px" } }, "Entries cannot be changed or deleted (GoBD). For a mistake, record a correction or refund."));
            } else if (k === "rides") {
              const rides = check(await sb.from("bookings").select("id, booking_reference, booking_start, status, payment_status, payment_method, price_amount, vehicle_name, contract_id").eq("customer_id", c.id).order("booking_start", { ascending: false }).limit(100));
              put(content, table({ rows: rides, onRow: (r) => { dr.close(); go("bookings", { id: r.id, range: "all", status: "all" }); }, emptyEl: empty("No rides yet", null, null, "calendar"), columns: [
                { label: "Date", render: (r) => dateTime(r.booking_start) }, { label: "Ref", render: (r) => h("div", {}, r.booking_reference, r.contract_id ? h("small", {}, "monthly") : null) },
                { label: "Vehicle", key: "vehicle_name" }, { label: "Price", cls: "right", render: (r) => money(r.price_amount) },
                { label: "Payment", render: (r) => (r.payment_method === "balance" ? badge("balance", "violet") : badge(r.payment_status)) }, { label: "Status", render: (r) => badge(r.status) }] }));
            } else if (k === "contracts") {
              const cs = check(await sb.from("ride_contracts").select("id, reference, status, start_date, end_date, destination_name, destination_address, agreed_price_per_ride, initial_price_per_ride").eq("customer_id", c.id).order("created_at", { ascending: false }));
              put(content, table({ rows: cs, onRow: (x) => { dr.close(); go("contracts", { id: x.id, filter: "all" }); }, emptyEl: empty("No monthly rides", null, null, "calendar"), columns: [
                { label: "Ref", key: "reference" }, { label: "Period", render: (x) => `${date(x.start_date)} – ${date(x.end_date)}` }, { label: "Destination", render: (x) => x.destination_name || x.destination_address },
                { label: "Price / ride", cls: "right", render: (x) => money(x.agreed_price_per_ride ?? x.initial_price_per_ride) }, { label: "Status", render: (x) => badge(x.status) }] }));
            }
          };
          dr.setBody([tabs([["overview", "Overview"], ["ledger", "Balance statement"], ["rides", "Rides"], ["contracts", "Monthly rides"]], show, active), content]);
          show(active);
          dr.setFooter([btn("Close", { onClick: dr.close })]);
        } catch (e) { toastError(e); dr.close(); }
      };
      drawAll();
    }

    async function deposit(c, after) {
      const cs = check(await sb.from("ride_contracts").select("id, reference, status").eq("customer_id", c.id).in("status", ["approved", "active", "paused", "negotiating", "request"]));
      const f = form([
        { name: "amount", label: "Amount (EUR)", type: "number", step: "0.01", min: 0.01, required: true },
        { name: "method", label: "Paid by", type: "select", options: METHODS, default: "bank_transfer" },
        { name: "date", label: "Date received", type: "date", default: todayISO(), required: true },
        { name: "reference", label: "Reference / note", placeholder: "e.g. bank transfer 12.10." },
        cs.length ? { name: "contract_id", label: "For monthly rides", type: "select", placeholder: "–", options: cs.map((x) => [x.id, `${x.reference} (${x.status})`]) } : null,
      ], { contract_id: cs[0]?.id }, { cols: 1 });
      const m = openDrawer({ title: "Record deposit", subtitle: fullName(c), body: h("div", {}, h("div", { class: "note", style: { marginBottom: "12px" } }, "The amount is added to the balance and booked as income (prepayment) in Finance."), f.el) });
      m.setFooter([btn("Cancel", { onClick: m.close }), btn("Save deposit", { variant: "primary", onClick: (e) => {
        if (!f.validate()) return;
        busy(e.currentTarget, async () => {
          try { const v = f.values(); const r = await rpc("admin_record_deposit", { p_customer_id: c.id, p_amount: v.amount, p_method: v.method, p_reference: v.reference, p_contract_id: v.contract_id || null, p_date: v.date }); toast(`Deposit saved · balance ${money(r.balance)}`); m.close(); after(); }
          catch (err) { toastError(err); }
        });
      } })]);
    }
    function refund(c, bal, after) {
      const f = form([
        { name: "amount", label: `Amount (max. ${money(bal?.available || 0)})`, type: "number", step: "0.01", min: 0.01, max: Number(bal?.available || 0), required: true },
        { name: "method", label: "Paid back by", type: "select", options: METHODS, default: "bank_transfer" },
        { name: "reference", label: "Reference" }, { name: "note", label: "Reason" },
      ], {}, { cols: 1 });
      const m = openDrawer({ title: "Refund balance", subtitle: fullName(c), body: f.el });
      m.setFooter([btn("Cancel", { onClick: m.close }), btn("Refund", { variant: "danger", onClick: (e) => {
        if (!f.validate()) return;
        busy(e.currentTarget, async () => {
          try { const v = f.values(); await rpc("admin_refund_balance", { p_customer_id: c.id, p_amount: v.amount, p_method: v.method, p_reference: v.reference, p_note: v.note }); toast("Refund saved"); m.close(); after(); }
          catch (err) { toastError(err); }
        });
      } })]);
    }

    await load();
    if (params.id) openDetail(params.id);
  },
};
