// Inbox: e-mails received through Resend (inbound). Empty until the domain + Resend are set up.
import { sb, check } from "../core/supabase.js";
import { h, card, empty, btn, clear, toastError, iconBtn, tabs, put } from "../core/ui.js";
import { dateTime, relative } from "../core/format.js";

export default {
  async render(root, { go, params }) {
    root.append(h("header", { class: "page-head" },
      h("div", {}, h("h1", {}, "Inbox"), h("p", { class: "muted" }, "Customer e-mails and replies, linked to bookings."))));

    const { data: integ } = await sb.from("integrations").select("status, enabled").eq("provider", "resend").maybeSingle();
    let rows = [];
    try { rows = check(await sb.from("inbox_messages").select("*").is("archived_at", null).order("received_at", { ascending: false }).limit(100)); }
    catch (e) { toastError(e); }

    if (!rows.length) {
      const ready = integ?.status === "connected";
      root.append(card(null, empty(
        ready ? "No messages yet" : "Inbox is not connected yet",
        ready ? "New e-mails will appear here." : "Once the website has its own domain, e-mail via Resend will be connected. Customer e-mails and booking replies will then show up here.",
        ready ? null : btn("See integrations", { ic: "plug", onClick: () => go("settings", { tab: "integrations" }) }), "mail")));
      return;
    }

    let filter = "all", selected = params.id || null;
    const listEl = h("ul", { class: "list inbox-list" });
    const readEl = h("div", { class: "inbox-read" });
    const box = h("div", { class: "inbox" }, listEl, readEl);

    const draw = () => {
      const shown = rows.filter((m) => filter === "all" || (filter === "unread" && !m.is_read) || (filter === "starred" && m.is_starred));
      put(listEl, ...shown.map((m) => h("li", { class: "is-click" + (m.id === selected ? " is-active" : ""), onClick: () => open(m) },
        h("div", { class: "li-main" },
          h("strong", { style: { fontWeight: m.is_read ? 500 : 700 } }, m.from_name || m.from_email),
          h("small", {}, m.subject || "(no subject)"),
          h("small", {}, relative(m.received_at))))));
      if (!shown.length) listEl.append(h("li", {}, h("span", { class: "muted" }, "Nothing here")));
    };
    const open = async (m) => {
      selected = m.id;
      put(readEl, 
        h("div", { class: "row between" }, h("h2", {}, m.subject || "(no subject)"),
          h("div", { class: "row" },
            iconBtn("star", m.is_starred ? "Unstar" : "Star", async () => { m.is_starred = !m.is_starred; await sb.from("inbox_messages").update({ is_starred: m.is_starred }).eq("id", m.id); open(m); }),
            iconBtn("download", "Archive", async () => { await sb.from("inbox_messages").update({ archived_at: new Date().toISOString() }).eq("id", m.id); rows = rows.filter((r) => r.id !== m.id); clear(readEl); draw(); }))),
        h("p", { class: "muted small" }, `${m.from_name || ""} <${m.from_email}> · ${dateTime(m.received_at)}`),
        m.booking_id ? btn("Open booking", { small: true, ic: "calendar", onClick: () => go("bookings", { id: m.booking_id }) }) : null,
        h("hr", { class: "divider" }),
        h("div", { style: { whiteSpace: "pre-wrap" } }, m.text_body || "(no text)"));
      if (!m.is_read) { m.is_read = true; sb.from("inbox_messages").update({ is_read: true }).eq("id", m.id).then(() => {}); }
      draw();
    };
    root.append(tabs([["all", "All"], ["unread", "Unread"], ["starred", "Starred"]], (k) => { filter = k; draw(); }, "all"), card(null, box, { cls: "flush" }));
    draw();
    const first = rows.find((r) => r.id === selected) || rows[0];
    if (first) open(first);
  },
};
