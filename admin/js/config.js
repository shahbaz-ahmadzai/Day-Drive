/*
 * Day Drive admin – connection settings
 * The publishable key is safe to be public: all data is protected by the
 * database security rules (RLS) – only logged-in admins can read or change anything.
 */
export const CONFIG = {
  SUPABASE_URL: "https://fhvfzmbopjfldugnsoju.supabase.co",
  SUPABASE_KEY: "sb_publishable_3k0F_L47Hltmk3bOq877cg_dkpMq_pK",
  COMPANY_NAME: "Day Drive Service",
  CURRENCY: "EUR",
  LOCALE: "de-DE",
  TIMEZONE: "Europe/Berlin",
  WEBSITE_URL: "../index.html",
  // same browser key as the booking page (Maps JavaScript API + Places API (New))
  GOOGLE_MAPS_API_KEY: "AIzaSyCacZqlH-aeLD4XtNYu0o3shrMEDB2SolU",
  MAP_CENTER: { lat: 50.1109, lng: 8.6821 },
};
