// Address search with Google Places (New) for the monthly rides form – same key as the booking page.
import { CONFIG, T, h, put } from "./core.js";

let loading = null;
export function loadMaps() {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.__ddAccMaps = resolve;
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CONFIG.GOOGLE_MAPS_API_KEY)}&v=weekly&loading=async&callback=__ddAccMaps&language=${window.DD_LANG || "en"}&region=DE`;
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error("maps")); };
    document.head.append(s);
  });
  return loading;
}

/* turns an <input> into an address field; onPick({ address, lat, lng, placeId, name }) or onPick(null) while typing */
export function addressField(input, onPick) {
  const list = h("div", { class: "ddb-suggest", role: "listbox" });
  input.after(list);
  input.setAttribute("autocomplete", "off");
  let token = null, run = 0, items = [], t;
  const close = () => { list.classList.remove("is-open"); put(list); };
  const info = (msg) => { put(list, h("div", { class: "ddb-suggest-info" }, msg)); list.classList.add("is-open"); };
  async function search(q) {
    const my = ++run;
    try {
      await loadMaps();
      const places = await google.maps.importLibrary("places");
      if (!token) token = new places.AutocompleteSessionToken();
      const res = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: q, sessionToken: token, includedRegionCodes: ["de"], language: window.DD_LANG || "en",
        locationBias: { center: CONFIG.MAP_CENTER, radius: 50000 } });
      if (my !== run) return;
      items = (res.suggestions || []).filter((x) => x.placePrediction).map((x) => x.placePrediction);
      if (!items.length) return info(T("mon.search.none"));
      put(list, items.map((p, i) => {
        const b = h("button", { type: "button", class: "ddb-suggest-item", role: "option" },
          h("span", { class: "ddb-suggest-main" }, p.mainText ? p.mainText.toString() : p.text.toString()),
          h("span", { class: "ddb-suggest-sub" }, p.secondaryText ? p.secondaryText.toString() : ""));
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => choose(i));
        return b;
      }));
      list.classList.add("is-open");
    } catch (e) { console.warn(e); if (my === run) info(T("mon.search.error")); }
  }
  async function choose(i) {
    const place = items[i].toPlace();
    try {
      await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
      token = null;
      input.value = place.formattedAddress || input.value;
      close();
      onPick({ address: place.formattedAddress, lat: place.location.lat(), lng: place.location.lng(), placeId: place.id, name: place.displayName || "" });
    } catch (e) { console.warn(e); info(T("mon.search.error")); }
  }
  input.addEventListener("input", () => {
    onPick(null);
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 3) return close();
    t = setTimeout(() => search(q), 250);
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && list.classList.contains("is-open") && items.length) { e.preventDefault(); choose(0); } });
}

/* driving distance of the whole plan (pickups in order → destination) with the Routes API; null when not possible */
export async function routeKm(points) {
  try {
    await loadMaps();
    const { Route } = await google.maps.importLibrary("routes");
    if (!Route) return null;
    const [origin, ...rest] = points;
    const destination = rest.pop();
    const { routes } = await Route.computeRoutes({
      origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng },
      intermediates: rest.map((p) => ({ location: { lat: p.lat, lng: p.lng } })), travelMode: "DRIVING", fields: ["distanceMeters", "durationMillis"],
    });
    const r = routes?.[0];
    return r ? { km: Math.round(r.distanceMeters / 10) / 100, minutes: Math.round((r.durationMillis || 0) / 60000) } : null;
  } catch (e) { console.warn("route", e); return null; }
}
