// Google Maps helpers for the admin panel (address search + map preview)
import { CONFIG } from "../config.js";

let loading = null;
export function loadMaps() {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    window.__ddAdminMaps = resolve;
    window.gm_authFailure = () => reject(new Error("The Google Maps key was rejected for this address."));
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CONFIG.GOOGLE_MAPS_API_KEY)}&v=weekly&loading=async&callback=__ddAdminMaps&language=en&region=DE`;
    s.async = true;
    s.onerror = () => { loading = null; reject(new Error("Google Maps could not be loaded.")); };
    document.head.append(s);
  });
  return loading;
}

/* place search while typing – returns [{ id, main, secondary, prediction }] */
let token = null;
export async function searchPlaces(input, near) {
  await loadMaps();
  const places = await google.maps.importLibrary("places");
  if (!token) token = new places.AutocompleteSessionToken();
  const req = { input, sessionToken: token, includedRegionCodes: ["de"], language: "en" };
  if (near) req.locationBias = { center: near, radius: 50000 };
  const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
  return (suggestions || []).filter((s) => s.placePrediction).map((s) => ({
    id: s.placePrediction.placeId,
    main: s.placePrediction.mainText?.text || s.placePrediction.text?.text,
    secondary: s.placePrediction.secondaryText?.text || "",
    prediction: s.placePrediction,
  }));
}
/* full details of a picked suggestion */
export async function placeDetails(prediction) {
  const place = prediction.toPlace();
  await place.fetchFields({ fields: ["displayName", "formattedAddress", "location"] });
  token = null; // a session ends when a place is picked
  return { name: place.displayName || "", address: place.formattedAddress || "", lat: place.location.lat(), lng: place.location.lng(), placeId: place.id };
}

/* small map with one marker + pickup circle */
export async function createAreaMap(el, { lat, lng, radiusKm, onMove }) {
  await loadMaps();
  const { Map, Circle } = await google.maps.importLibrary("maps");
  const { Marker } = await google.maps.importLibrary("marker");
  const center = { lat: Number(lat) || CONFIG.MAP_CENTER.lat, lng: Number(lng) || CONFIG.MAP_CENTER.lng };
  const map = new Map(el, { center, zoom: 9, disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: "cooperative" });
  const marker = new Marker({ map, position: center, draggable: true, title: "Drag to move the centre" });
  const circle = new Circle({ map, center, radius: (radiusKm || 50) * 1000, strokeColor: "#b8893a", strokeWeight: 2, strokeOpacity: 0.9, fillColor: "#d9ae5f", fillOpacity: 0.12, clickable: false });
  const fit = () => map.fitBounds(circle.getBounds(), 24);
  marker.addListener("dragend", () => { const p = marker.getPosition(); circle.setCenter(p); onMove && onMove(p.lat(), p.lng()); });
  map.addListener("click", (e) => { marker.setPosition(e.latLng); circle.setCenter(e.latLng); onMove && onMove(e.latLng.lat(), e.latLng.lng()); });
  fit();
  return {
    setCenter(la, ln) { const p = { lat: la, lng: ln }; marker.setPosition(p); circle.setCenter(p); fit(); },
    setRadius(km) { circle.setRadius(km * 1000); fit(); },
    map,
  };
}

/* overview map with every area */
export async function createOverviewMap(el, areas) {
  await loadMaps();
  const { Map, Circle } = await google.maps.importLibrary("maps");
  const { Marker } = await google.maps.importLibrary("marker");
  const map = new Map(el, { center: CONFIG.MAP_CENTER, zoom: 8, disableDefaultUI: true, zoomControl: true, clickableIcons: false, gestureHandling: "cooperative" });
  const bounds = new google.maps.LatLngBounds();
  for (const a of areas) {
    const c = { lat: Number(a.latitude), lng: Number(a.longitude) };
    new Marker({ map, position: c, title: a.name, opacity: a.is_active ? 1 : 0.5 });
    const circle = new Circle({ map, center: c, radius: Number(a.pickup_radius_km) * 1000, strokeColor: a.is_active ? "#b8893a" : "#9aa0a9",
      strokeWeight: 2, fillColor: a.is_active ? "#d9ae5f" : "#c9ccd2", fillOpacity: 0.12, clickable: false });
    bounds.union(circle.getBounds());
  }
  if (areas.length) map.fitBounds(bounds, 24);
  return map;
}
