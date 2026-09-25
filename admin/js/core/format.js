// Formatting helpers (German number/date format, Berlin time)
import { CONFIG } from "../config.js";

const TZ = CONFIG.TIMEZONE, LOC = CONFIG.LOCALE;
const moneyFmt = new Intl.NumberFormat(LOC, { style: "currency", currency: CONFIG.CURRENCY });
const numFmt = new Intl.NumberFormat(LOC, { maximumFractionDigits: 2 });

export const money = (v) => (v === null || v === undefined || v === "" ? "–" : moneyFmt.format(Number(v)));
export const num = (v, d = 2) => (v === null || v === undefined || v === "" ? "–" :
  new Intl.NumberFormat(LOC, { maximumFractionDigits: d }).format(Number(v)));
export const plain = (v) => (v === null || v === undefined || v === "" ? "–" : numFmt.format(Number(v)));

export function date(v) {
  if (!v) return "–";
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T12:00:00Z") : new Date(v);
  return new Intl.DateTimeFormat(LOC, { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}
export function dateTime(v) {
  if (!v) return "–";
  return new Intl.DateTimeFormat(LOC, { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
}
export function time(v) {
  if (!v) return "–";
  return new Intl.DateTimeFormat(LOC, { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(v));
}
export function weekdayDate(v) {
  if (!v) return "–";
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" }).format(new Date(v));
}
export function relative(v) {
  if (!v) return "–";
  const s = Math.round((new Date(v) - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(s, "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
/* days from today (Berlin) until a date string; negative = overdue */
export function daysUntil(v) {
  if (!v) return null;
  const today = todayISO();
  return Math.round((new Date(v + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 86400000);
}
/* YYYY-MM-DD for today in Berlin */
export function todayISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
/* "2026-09-25T14:30" in Berlin → ISO UTC string */
export function berlinLocalToISO(local) {
  if (!local) return null;
  const [d, t = "00:00"] = local.split("T");
  const guess = new Date(`${d}T${t}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(guess).reduce((o, p) => (o[p.type] = p.value, o), {});
  const asBerlin = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asBerlin - guess.getTime())).toISOString();
}
/* ISO → "YYYY-MM-DDTHH:mm" in Berlin (for datetime-local inputs) */
export function isoToBerlinLocal(iso) {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(iso)).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const fullName = (o) => [o?.first_name, o?.last_name].filter(Boolean).join(" ") || "–";
export const initials = (o) => ((o?.first_name || "?")[0] + (o?.last_name || "")[0] || "").toUpperCase();
export const label = (s) => (s ? String(s).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "–");
