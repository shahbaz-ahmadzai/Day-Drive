// Booking page add-on: logged-in My Day Drive customers can pay a ride from their balance
// (e.g. an extra ride next to their monthly rides). Also fills in their name and contact details.
// The server checks the balance again and applies the contract discount – this file only offers the choice.
import { sb, rpc, T, h, put, money } from "./account/core.js";

const box = document.getElementById("ddbBalance");
const B = window.DDBalance = { use: false, available: 0, discount: 0, price: null,
  async token() { const { data } = await sb.auth.getSession(); return data.session?.access_token || null; } };

function draw() {
  if (!box) return;
  const net = B.price != null ? Math.round(B.price * (1 - B.discount / 100) * 100) / 100 : null;
  const enough = net == null || net <= B.available;
  if (!enough && B.use) B.use = false;
  const opt = (val, title, sub, disabled) => h("label", { class: "ddb-bal-opt" + (B.use === val ? " is-active" : "") + (disabled ? " is-disabled" : "") },
    h("input", { type: "radio", name: "ddbPayWith", checked: B.use === val, disabled, onChange: () => { B.use = val; draw(); } }),
    h("span", {}, h("b", {}, title), sub ? h("small", {}, sub) : null));
  put(box,
    h("p", { class: "ddb-bal-title" }, T("bk.bal.title")),
    opt(false, T("bk.bal.driver")),
    opt(true, T("bk.bal.use"), [T("bk.bal.available", { amount: money(B.available) }), B.discount > 0 ? T("bk.bal.discount", { pct: B.discount }) : null,
      !enough ? T("bk.bal.low") : net != null && B.discount > 0 ? money(net) : null].filter(Boolean).join(" · "), !enough));
  box.hidden = false;
}

(async () => {
  try {
    const { data } = await sb.auth.getSession();
    if (!data.session) return;
    const [bal, ov] = await Promise.all([rpc("customer_balance_for_booking"), rpc("customer_overview").catch(() => null)]);
    // fill the contact form for logged-in customers
    const c = ov?.customer;
    if (c) [["ddbFirstName", c.first_name], ["ddbLastName", c.last_name], ["ddbEmail", c.email], ["ddbPhone", c.phone]].forEach(([id, v]) => { const i = document.getElementById(id); if (i && !i.value && v) i.value = v; });
    if (!bal?.logged_in || !(Number(bal.available) > 0)) return;
    B.available = Number(bal.available); B.discount = Number(bal.discount_pct || 0);
    draw();
  } catch (e) { console.warn("balance", e); }
})();
document.addEventListener("dd:vehicle", (e) => { B.price = Number(e.detail?.price); if (!box.hidden) draw(); });
document.addEventListener("dd:langchange", () => { if (!box.hidden) draw(); });
