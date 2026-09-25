// Profile: own details and password
import { sb, check } from "../core/supabase.js";
import { h, btn, card, toast, toastError, form, busy, dl, badge } from "../core/ui.js";
import { dateTime, initials, fullName } from "../core/format.js";
import { me, changePassword, passwordProblem, ROLE_INFO, loadProfile } from "../core/auth.js";

export default {
  async render(root) {
    const u = me();
    root.append(h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "My profile"), h("p", { class: "muted" }, "Your details and password."))));

    const details = form([
      { name: "first_name", label: "First name", required: true },
      { name: "last_name", label: "Last name", required: true },
      { name: "phone", label: "Mobile", type: "tel" },
      { name: "email", label: "Contact e-mail", type: "email", hint: "Used for notifications later. Your login stays your username." },
      { name: "language", label: "Preferred language", type: "select", options: [["en", "English"], ["de", "German"]] },
    ], u);
    const saveDetails = btn("Save details", { variant: "primary", onClick: () => {
      if (!details.validate()) return;
      busy(saveDetails, async () => {
        try {
          const v = details.values();
          if (v.email) v.email = v.email.toLowerCase();
          check(await sb.from("admin_users").update(v).eq("id", u.id));
          await loadProfile();
          document.querySelector(".user-meta strong").textContent = fullName(me());
          document.querySelector(".user-btn .avatar").textContent = initials(me());
          toast("Details saved");
        } catch (e) { toastError(e); }
      });
    } });

    const pw = form([
      { name: "current", label: "Current password", type: "password", required: true, span: 2, autocomplete: "current-password" },
      { name: "pw1", label: "New password", type: "password", required: true, hint: "At least 10 characters with letters and numbers.", validate: (v) => passwordProblem(v, u.username) },
      { name: "pw2", label: "Repeat new password", type: "password", required: true, validate: (v, api) => (v !== api.inputs.pw1.input.value ? "The passwords don't match." : "") },
    ]);
    const savePw = btn("Change password", { variant: "primary", onClick: () => {
      if (!pw.validate()) return;
      busy(savePw, async () => {
        try { const v = pw.values(); await changePassword(v.pw1, v.current); toast("Password changed"); ["current", "pw1", "pw2"].forEach((n) => pw.set(n, "")); }
        catch (e) { toastError(e); }
      });
    } });

    root.append(h("div", { class: "grid grid-main" },
      h("div", { class: "stack" },
        card("Personal details", h("div", {}, details.el, h("div", { class: "form-actions", style: { marginTop: "16px" } }, saveDetails))),
        card("Password", h("div", {}, pw.el, h("div", { class: "form-actions", style: { marginTop: "16px" } }, savePw)))),
      card("Account", h("div", {},
        h("div", { class: "row", style: { marginBottom: "16px" } }, h("span", { class: "avatar lg" }, initials(u)),
          h("div", {}, h("h3", {}, fullName(u)), h("p", { class: "muted" }, "@" + u.username))),
        dl([
          ["Username", h("span", { class: "mono" }, u.username)],
          ["Role", h("span", {}, badge(u.role), h("small", { class: "muted", style: { display: "block", marginTop: "4px" } }, ROLE_INFO[u.role]))],
          ["Last sign-in", dateTime(u.last_login_at)],
          ["Account since", dateTime(u.created_at)],
        ]),
        h("p", { class: "muted small", style: { marginTop: "14px" } }, "Only the owner can change usernames and roles (Settings → Team).")))));
  },
};
