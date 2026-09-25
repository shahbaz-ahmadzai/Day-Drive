// One shared Supabase client for the whole admin panel
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "../config.js";

export const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "dd-admin-auth" },
});

/* call an Edge Function and always get { data } or a thrown Error with a readable message */
export async function callFunction(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch (_) {}
    throw new Error(msg);
  }
  if (data && data.success === false) throw new Error(data.error || "Request failed");
  return data;
}

/* throw readable errors from table queries */
export function check({ data, error, count }) {
  if (error) throw new Error(error.message);
  return count !== undefined && count !== null ? { data, count } : data;
}

export function publicFileUrl(bucket, path) {
  if (!path) return null;
  if (path.startsWith("site:")) return "../" + path.slice(5);
  if (/^https?:/.test(path)) return path;
  return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
export async function signedFileUrl(bucket, path, seconds = 300) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
export async function uploadFile(bucket, folder, file) {
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}
