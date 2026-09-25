// Sign-in, session guard and the current admin's profile + permissions
import { sb, callFunction, check } from "./supabase.js";

let current = null;

/* permissions per role – one place to change who may do what */
export const PERMISSIONS = {
  owner:      ["*"],
  admin:      ["bookings.edit", "fleet.edit", "drivers.edit", "finance.view", "finance.edit", "expenses.add", "settings.edit", "audit.view"],
  dispatcher: ["bookings.edit", "fleet.edit", "drivers.edit", "expenses.add"],
  accountant: ["finance.view", "finance.edit", "expenses.add"],
};
export const ROLE_INFO = {
  owner: "Full access, manages team logins",
  admin: "Everything except team logins",
  dispatcher: "Bookings, vehicles, drivers, add expenses",
  accountant: "Finance and expenses (read-only elsewhere)",
};
export function can(perm) {
  const p = PERMISSIONS[current?.role] || [];
  return p.includes("*") || p.includes(perm);
}
export const me = () => current;

export async function signIn(login, password) {
  const { email } = await callFunction("admin-login", { login: login.trim() });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(/invalid/i.test(error.message) ? "Username or password is wrong." : error.message);
  const profile = await loadProfile();
  if (!profile) { await sb.auth.signOut(); throw new Error("This login has no admin access."); }
  if (!profile.is_active) { await sb.auth.signOut(); throw new Error("This login is deactivated."); }
  sb.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", profile.id).then(() => {});
  return profile;
}

export async function loadProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return (current = null);
  const row = check(await sb.from("admin_users").select("*").eq("id", user.id).maybeSingle());
  current = row ? { ...row, auth_email: user.email } : null;
  return current;
}

/* used by app.html – sends you to the login page when not signed in */
export async function requireAdmin() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace("index.html"); return null; }
  const p = await loadProfile().catch(() => null);
  if (!p || !p.is_active) { await sb.auth.signOut(); location.replace("index.html?denied=1"); return null; }
  return p;
}

export async function changePassword(newPassword, currentPassword) {
  if (currentPassword) {   // re-check the current password first
    const { error: e1 } = await sb.auth.signInWithPassword({ email: current.auth_email, password: currentPassword });
    if (e1) throw new Error("The current password is wrong.");
  }
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw new Error(/same/i.test(error.message) ? "Choose a password that is different from the old one." : error.message);
  check(await sb.from("admin_users").update({ must_change_password: false }).eq("id", current.id));
  current.must_change_password = false;
}

export function passwordProblem(pw, username) {
  if (!pw || pw.length < 10) return "Use at least 10 characters.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Use letters and numbers.";
  if (username && pw.toLowerCase().includes(username.toLowerCase())) return "Don't use your username in the password.";
  if (/^(\d)\1+$|123456|password|daydrive/i.test(pw)) return "This password is too easy to guess.";
  return "";
}

export async function signOut() {
  await sb.auth.signOut();
  location.replace("index.html");
}
