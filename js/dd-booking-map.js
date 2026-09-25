/*
 * Day Drive Service – booking page, step 1: route
 * Google Maps map, address search (pickup, stops, destination), map clicks,
 * driving route, service-area check, date/time check and the "Book Now" button.
 * When the route is complete it sends the trip to dd-booking-checkout.js
 * with the event "dd:open-booking".
 */
(function () {
  "use strict";

  var API = window.DDBookingAPI;
  var C = API.config;
  var T = function (k, v) { return window.ddT ? window.ddT(k, v) : k; };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- page elements ---------- */
  var el = {
    pickup: $("ddbPickup"), pickupList: $("ddbPickupList"), pickupClear: $("ddbPickupClear"),
    dest: $("ddbDestination"), destList: $("ddbDestinationList"), destClear: $("ddbDestinationClear"),
    stops: $("ddbStops"), addStop: $("ddbAddStop"), stopSummary: $("ddbStopSummary"),
    date: $("ddbDate"), time: $("ddbTime"),
    modePickup: $("ddbModePickup"), modeDest: $("ddbModeDestination"),
    help: $("ddbPickupHelp"),
    map: $("ddbMap"), tip: $("ddbMapTip"),
    distance: $("ddbDistance"), duration: $("ddbDuration"),
    message: $("ddbRouteMessage"), book: $("ddbBookNow"),
    alert: $("ddbAreaAlert")
  };

  /* ---------- state ---------- */
  var S = {
    map: null, places: null, Route: null,
    pickup: null, destination: null,
    stops: [], stopSeq: 0,
    markers: { pickup: null, destination: null, stops: {} },
    routeLine: null, areaCircles: [],
    areas: [], areaOk: false, areaId: null,
    distanceKm: null, drivingMin: null, routeSource: null,
    mode: "pickup", routeRun: 0
  };

  /* ==========================================================
     Helpers
     ========================================================== */
  function showMessage(text, type) {
    el.message.textContent = text || "";
    el.message.className = "ddb-route-message" + (type ? " is-" + type : "");
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function haversineKm(a, b) {
    var R = 6371.0088, toR = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
    var h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function validStops() {
    return S.stops.filter(function (s) { return s.place && isFinite(s.place.lat) && isFinite(s.place.lng); });
  }
  function totalWait() {
    return validStops().reduce(function (sum, s) { return sum + (Number(s.waitMinutes) || 0); }, 0);
  }
  function waitFee() { return Math.round(totalWait() * C.WAIT_RATE_PER_MINUTE * 100) / 100; }
  function pad(n) { return String(n).padStart(2, "0"); }
  function localDateValue(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function selectedStart() {
    if (!el.date.value || !el.time.value) return null;
    var d = new Date(el.date.value + "T" + el.time.value + ":00");
    return isNaN(d.getTime()) ? null : d;
  }
  function timeIsValid() {
    var d = selectedStart();
    return !!d && d.getTime() >= Date.now() + C.MIN_NOTICE_MINUTES * 60000;
  }
  function formatDuration(min) {
    if (min == null) return "—";
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + " h " + pad(m) + " min" : m + " min";
  }

  /* ==========================================================
     Google Maps loading
     ========================================================== */
  function loadGoogleMaps() {
    return new Promise(function (resolve, reject) {
      if (window.google && google.maps && google.maps.importLibrary) return resolve();
      window.__ddbMapsReady = resolve;
      window.gm_authFailure = function () { reject(new Error("Google Maps key was rejected")); };
      var s = document.createElement("script");
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(C.GOOGLE_MAPS_API_KEY) +
        "&v=weekly&loading=async&callback=__ddbMapsReady&language=" + (window.DD_LANG || "en") + "&region=DE";
      s.async = true;
      s.onerror = function () { reject(new Error("Google Maps script could not be loaded")); };
      document.head.appendChild(s);
    });
  }

  var MAP_STYLE = [
    { elementType: "geometry", stylers: [{ color: "#1b1e24" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#9aa0a8" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#14171c" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c313a" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#4a4130" }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#d9ae5f" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1a26" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#e3e4e6" }] }
  ];

  async function initMap() {
    try {
      await loadGoogleMaps();
      var maps = await google.maps.importLibrary("maps");
      S.places = await google.maps.importLibrary("places");
      try { S.Route = (await google.maps.importLibrary("routes")).Route || null; } catch (e) { S.Route = null; }
      S.map = new maps.Map(el.map, {
        center: C.MAP_CENTER, zoom: C.MAP_ZOOM, styles: MAP_STYLE,
        disableDefaultUI: true, zoomControl: true, fullscreenControl: false, clickableIcons: false,
        gestureHandling: "cooperative"
      });
      S.map.addListener("click", onMapClick);
      drawServiceAreas();
      document.body.classList.add("ddb-map-ready");
    } catch (err) {
      console.error("Map error:", err);
      el.map.innerHTML = '<div class="ddb-map-error">' + esc(T("bk.err.mapLoad")) + "</div>";
    }
  }

  /* ---------- markers ---------- */
  function markerIcon(color, label) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">' +
      '<path d="M17 43C17 43 32 27.5 32 17A15 15 0 0 0 2 17C2 27.5 17 43 17 43Z" fill="' + color + '" stroke="#0e1116" stroke-width="2"/>' +
      '<circle cx="17" cy="17" r="7.5" fill="#0e1116"/>' +
      (label ? '<text x="17" y="21.5" text-anchor="middle" font-family="Arial" font-weight="700" font-size="11" fill="' + color + '">' + label + "</text>" : "") +
      "</svg>";
    return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(34, 44), anchor: new google.maps.Point(17, 43) };
  }
  function setMarker(key, place, color, label, onDrag) {
    if (!S.map) return null;
    var existing = key === "pickup" || key === "destination" ? S.markers[key] : S.markers.stops[key];
    if (existing) existing.setMap(null);
    if (!place) return null;
    var m = new google.maps.Marker({ map: S.map, position: { lat: place.lat, lng: place.lng },
      icon: markerIcon(color, label), draggable: true, title: place.address });
    m.addListener("dragend", async function (e) {
      var p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      var address = await reverseLookup(p);
      onDrag({ address: address, lat: p.lat, lng: p.lng, placeId: null });
    });
    if (key === "pickup" || key === "destination") S.markers[key] = m; else S.markers.stops[key] = m;
    return m;
  }

  /* ---------- service areas ---------- */
  async function loadAreas() {
    try {
      var cfg = await API.getBookingConfig();
      S.areas = (cfg && cfg.companies) || [];
    } catch (e) {
      console.error("Booking config error:", e);
      S.areas = [];
    }
    drawServiceAreas();
    checkArea(false);
    updateBookButton();
  }
  function drawServiceAreas() {
    if (!S.map) return;
    S.areaCircles.forEach(function (c) { c.setMap(null); });
    S.areaCircles = S.areas.map(function (a) {
      return new google.maps.Circle({ map: S.map, center: { lat: Number(a.latitude), lng: Number(a.longitude) },
        radius: Number(a.pickup_radius_km) * 1000, strokeColor: "#d9ae5f", strokeOpacity: .7, strokeWeight: 1.5,
        fillColor: "#d9ae5f", fillOpacity: .06, clickable: false });
    });
  }
  function checkArea(showAlert) {
    S.areaOk = false; S.areaId = null;
    if (!S.pickup) { hideAlert(); return false; }
    for (var i = 0; i < S.areas.length; i++) {
      var a = S.areas[i];
      if (haversineKm({ lat: Number(a.latitude), lng: Number(a.longitude) }, S.pickup) <= Number(a.pickup_radius_km)) {
        S.areaOk = true; S.areaId = a.id; break;
      }
    }
    if (S.areaOk) hideAlert(); else if (showAlert) el.alert.hidden = false;
    return S.areaOk;
  }
  function hideAlert() { el.alert.hidden = true; }

  /* ==========================================================
     Address search (Places API New) – our own dropdown
     ========================================================== */
  function attachAutocomplete(input, list, onSelect) {
    var timer = null, token = null, results = [], active = -1, run = 0;

    function close() { list.innerHTML = ""; list.classList.remove("is-open"); active = -1; input.setAttribute("aria-expanded", "false"); }
    function info(text) { list.innerHTML = '<div class="ddb-suggest-info">' + esc(text) + "</div>"; list.classList.add("is-open"); }
    function highlight(i) {
      var items = list.querySelectorAll(".ddb-suggest-item");
      items.forEach(function (b, n) { b.classList.toggle("is-active", n === i); });
      active = i;
    }
    async function choose(i) {
      var s = results[i]; if (!s) return;
      close();
      input.value = s.main + (s.secondary ? ", " + s.secondary : "");
      try {
        var place = s.prediction.toPlace();
        await place.fetchFields({ fields: ["formattedAddress", "location"] });
        token = null;
        onSelect({ address: place.formattedAddress || input.value, lat: place.location.lat(), lng: place.location.lng(), placeId: place.id || null });
      } catch (e) {
        console.error("Place details error:", e);
        showMessage(T("bk.search.error"), "error");
      }
    }
    async function search(q) {
      var my = ++run;
      if (!S.places) { info(T("bk.search.error")); return; }
      info(T("bk.search.searching"));
      try {
        if (!token) token = new S.places.AutocompleteSessionToken();
        var req = { input: q, sessionToken: token, includedRegionCodes: C.COUNTRY_CODES, language: window.DD_LANG || "en" };
        if (S.map) req.locationBias = { center: S.map.getCenter().toJSON(), radius: 50000 };
        var res = await S.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
        if (my !== run || input.value.trim() !== q) return;
        results = (res.suggestions || []).filter(function (x) { return x.placePrediction; }).map(function (x) {
          var p = x.placePrediction;
          return { prediction: p, main: p.mainText ? p.mainText.toString() : p.text.toString(), secondary: p.secondaryText ? p.secondaryText.toString() : "" };
        });
        if (!results.length) { info(T("bk.search.none")); return; }
        list.innerHTML = results.map(function (r, i) {
          return '<button type="button" class="ddb-suggest-item" role="option" data-i="' + i + '"><span class="ddb-suggest-main">' + esc(r.main) +
            '</span><span class="ddb-suggest-sub">' + esc(r.secondary) + "</span></button>";
        }).join("");
        list.classList.add("is-open"); input.setAttribute("aria-expanded", "true");
        list.querySelectorAll(".ddb-suggest-item").forEach(function (b) {
          b.addEventListener("mousedown", function (e) { e.preventDefault(); });
          b.addEventListener("click", function () { choose(Number(b.dataset.i)); });
        });
      } catch (e) {
        if (my !== run) return;
        console.error("Autocomplete error:", e);
        info(T("bk.search.error"));
      }
    }

    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-autocomplete", "list");
    input.addEventListener("input", function () {
      onSelect(null, true);            // typing clears the chosen place
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 3) { close(); return; }
      timer = setTimeout(function () { search(q); }, 300);
    });
    input.addEventListener("keydown", function (e) {
      var n = results.length;
      if (!list.classList.contains("is-open") || !n) return;
      if (e.key === "ArrowDown") { e.preventDefault(); highlight((active + 1) % n); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight((active - 1 + n) % n); }
      else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(active); }
      else if (e.key === "Escape") close();
    });
    input.addEventListener("blur", function () { setTimeout(close, 150); });
  }

  /* reverse lookup for map clicks and dragged markers (no Geocoding API needed) */
  async function reverseLookup(p) {
    var fallback = p.lat.toFixed(5) + ", " + p.lng.toFixed(5);
    try {
      var r = await S.places.Place.searchNearby({
        fields: ["formattedAddress", "location"],
        locationRestriction: { center: p, radius: 80 },
        maxResultCount: 1,
        rankPreference: S.places.SearchNearbyRankPreference.DISTANCE,
        language: window.DD_LANG || "en"
      });
      return (r.places && r.places[0] && r.places[0].formattedAddress) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  /* ==========================================================
     Pickup / destination / stops
     ========================================================== */
  function setPickup(place, typing) {
    S.pickup = place;
    if (!typing && place) el.pickup.value = place.address;
    setMarker("pickup", place, "#3ddc84", "A", function (p) { setPickup(p); });
    checkArea(!!place);
    afterPlacesChanged();
  }
  function setDestination(place, typing) {
    S.destination = place;
    if (!typing && place) el.dest.value = place.address;
    setMarker("destination", place, "#ff6b6b", "B", function (p) { setDestination(p); });
    afterPlacesChanged();
  }
  function afterPlacesChanged() {
    el.addStop.hidden = !(S.pickup && S.destination) || S.stops.length >= C.MAX_STOPS;
    if (S.pickup && S.destination) calculateRoute();
    else clearRoute();
    updateStopSummary();
  }

  function addStop() {
    if (S.stops.length >= C.MAX_STOPS) return;
    S.stops.push({ id: ++S.stopSeq, place: null, waitMinutes: C.DEFAULT_WAIT_MINUTES });
    renderStops();
    var inputs = el.stops.querySelectorAll(".ddb-stop-input");
    if (inputs.length) inputs[inputs.length - 1].focus();
    el.addStop.hidden = S.stops.length >= C.MAX_STOPS;
  }
  function removeStop(id) {
    var m = S.markers.stops[id]; if (m) m.setMap(null); delete S.markers.stops[id];
    S.stops = S.stops.filter(function (s) { return s.id !== id; });
    renderStops();
    el.addStop.hidden = !(S.pickup && S.destination) || S.stops.length >= C.MAX_STOPS;
    calculateRoute();
  }
  function renderStops() {
    el.stops.innerHTML = S.stops.map(function (s, i) {
      return '<div class="ddb-stop" data-id="' + s.id + '">' +
        '<div class="ddb-field ddb-stop-address"><label>' + esc(T("bk.stop", { n: i + 1 })) + '</label>' +
        '<div class="ddb-input"><span class="ddb-dot is-stop">' + (i + 1) + '</span>' +
        '<input type="text" class="ddb-stop-input" placeholder="' + esc(T("bk.stop.ph")) + '" value="' + esc(s.place ? s.place.address : "") + '">' +
        '<button type="button" class="ddb-clear ddb-stop-remove" aria-label="' + esc(T("bk.stop.remove")) + '">×</button></div>' +
        '<div class="ddb-suggest" role="listbox"></div></div>' +
        '<div class="ddb-field ddb-stop-wait"><label>' + esc(T("bk.stop.wait")) + '</label>' +
        '<div class="ddb-input ddb-wait-box"><input type="number" class="ddb-wait-input" min="0" max="' + C.MAX_WAIT_MINUTES + '" step="5" value="' + s.waitMinutes + '" inputmode="numeric">' +
        "<span>" + esc(T("bk.stop.min")) + "</span></div></div></div>";
    }).join("");
    el.stops.querySelectorAll(".ddb-stop").forEach(function (row, i) {
      var id = Number(row.dataset.id), s = S.stops.find(function (x) { return x.id === id; });
      var input = row.querySelector(".ddb-stop-input");
      attachAutocomplete(input, row.querySelector(".ddb-suggest"), function (place, typing) {
        s.place = place;
        if (place) {
          input.value = place.address;
          setMarker(id, place, "#d9ae5f", String(i + 1), function (p) { s.place = p; input.value = p.address; calculateRoute(); });
          calculateRoute();
        } else if (!typing) { setMarker(id, null); }
        else { setMarker(id, null); }
      });
      if (s.place) setMarker(id, s.place, "#d9ae5f", String(i + 1), function (p) { s.place = p; input.value = p.address; calculateRoute(); });
      row.querySelector(".ddb-wait-input").addEventListener("change", function (e) {
        s.waitMinutes = Math.max(0, Math.min(C.MAX_WAIT_MINUTES, Math.round(Number(e.target.value) || 0)));
        e.target.value = s.waitMinutes;
        updateStopSummary(); updateResult();
      });
      row.querySelector(".ddb-stop-remove").addEventListener("click", function () { removeStop(id); });
    });
    updateStopSummary();
  }
  function updateStopSummary() {
    var n = validStops().length;
    el.stopSummary.textContent = n
      ? T("bk.stops.summary", { count: n, min: totalWait(), fee: waitFee().toLocaleString(window.DD_LANG === "de" ? "de-DE" : "en-GB", { minimumFractionDigits: 2 }) })
      : T("bk.stops.none");
    el.stopSummary.hidden = !(S.pickup && S.destination);
  }

  /* ==========================================================
     Route
     ========================================================== */
  function clearRoute() {
    S.distanceKm = null; S.drivingMin = null; S.routeSource = null;
    if (S.routeLine) { S.routeLine.setMap(null); S.routeLine = null; }
    updateResult();
  }
  async function calculateRoute() {
    if (!S.pickup || !S.destination) { clearRoute(); return; }
    var my = ++S.routeRun;
    el.book.disabled = true;
    showMessage(T("bk.calculating"), "info");
    var points = [S.pickup].concat(validStops().map(function (s) { return s.place; }), [S.destination]);
    try {
      if (!S.Route) throw new Error("Routes library not available");
      var res = await S.Route.computeRoutes({
        origin: { lat: S.pickup.lat, lng: S.pickup.lng },
        destination: { lat: S.destination.lat, lng: S.destination.lng },
        intermediates: validStops().map(function (s) { return { location: { lat: s.place.lat, lng: s.place.lng } }; }),
        travelMode: "DRIVING",
        fields: ["distanceMeters", "durationMillis", "path"]
      });
      if (my !== S.routeRun) return;
      var r = res.routes && res.routes[0];
      if (!r || !isFinite(r.distanceMeters)) throw new Error("No route");
      S.distanceKm = r.distanceMeters / 1000;
      S.drivingMin = Math.max(1, Math.round(Number(r.durationMillis) / 60000));
      S.routeSource = "google";
      drawLine(r.path);
      showMessage("", "");
    } catch (e) {
      if (my !== S.routeRun) return;
      console.warn("Routing failed, using an estimate:", e);
      // estimate: straight line × 1.3, average 55 km/h – keeps the demo usable
      var km = 0;
      for (var i = 1; i < points.length; i++) km += haversineKm(points[i - 1], points[i]);
      S.distanceKm = km * 1.3;
      S.drivingMin = Math.max(5, Math.round(S.distanceKm / 55 * 60));
      S.routeSource = "estimate";
      drawLine(points, true);
      showMessage(T("bk.err.routeFallback"), "info");
    }
    updateResult();
  }
  function drawLine(path, dashed) {
    if (!S.map) return;
    if (S.routeLine) S.routeLine.setMap(null);
    var coords = (path || []).map(function (p) {
      return { lat: typeof p.lat === "function" ? p.lat() : p.lat, lng: typeof p.lng === "function" ? p.lng() : p.lng };
    });
    S.routeLine = new google.maps.Polyline(dashed ? {
      map: S.map, path: coords, strokeOpacity: 0,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: "#d9ae5f", scale: 3 }, offset: "0", repeat: "14px" }]
    } : { map: S.map, path: coords, strokeColor: "#d9ae5f", strokeOpacity: .95, strokeWeight: 5 });
    var b = new google.maps.LatLngBounds();
    coords.forEach(function (c) { b.extend(c); });
    if (!b.isEmpty()) S.map.fitBounds(b, window.innerWidth > 980 ? { top: 70, right: 60, bottom: 60, left: 60 } : 40);
  }
  function updateResult() {
    updateStopSummary();
    var has = S.distanceKm != null;
    el.distance.textContent = has ? S.distanceKm.toLocaleString(window.DD_LANG === "de" ? "de-DE" : "en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " km" + (S.routeSource === "estimate" ? " (" + T("bk.estimated") + ")" : "") : "—";
    el.duration.textContent = has ? formatDuration(S.drivingMin + totalWait()) : "—";
    updateBookButton();
  }
  function updateBookButton() {
    el.book.disabled = !(S.pickup && S.destination && S.distanceKm != null && S.areaOk && el.date.value && el.time.value && timeIsValid());
  }

  /* ==========================================================
     Map clicks + mode buttons
     ========================================================== */
  function setMode(m) {
    S.mode = m;
    el.modePickup.classList.toggle("is-active", m === "pickup");
    el.modeDest.classList.toggle("is-active", m === "destination");
    el.modePickup.setAttribute("aria-pressed", m === "pickup");
    el.modeDest.setAttribute("aria-pressed", m === "destination");
    el.tip.textContent = T(m === "pickup" ? "bk.tip.pickup" : "bk.tip.destination");
  }
  async function onMapClick(e) {
    var p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    el.tip.textContent = T("bk.tip.finding");
    try {
      var address = await reverseLookup(p);
      var place = { address: address, lat: p.lat, lng: p.lng, placeId: null };
      if (S.mode === "pickup") { setPickup(place); setMode("destination"); }
      else { setDestination(place); setMode("pickup"); }
    } catch (err) {
      showMessage(T("bk.err.mapPoint"), "error");
      setMode(S.mode);
    }
  }

  /* ==========================================================
     Trip data for the next step (values listed in BOOKING-BACKEND.md)
     ========================================================== */
  function buildTripPayload() {
    var start = selectedStart();
    var durationMin = S.drivingMin + totalWait();
    var end = new Date(start.getTime() + durationMin * 60000);
    var clean = function (p) { return { address: p.address, lat: p.lat, lng: p.lng, placeId: p.placeId || null }; };
    return {
      pickup: clean(S.pickup),
      destination: clean(S.destination),
      stops: validStops().map(function (s) { return Object.assign(clean(s.place), { waitMinutes: Number(s.waitMinutes) || 0 }); }),
      bookingDate: el.date.value,
      bookingTime: el.time.value,
      bookingStart: start.toISOString(),
      bookingEnd: end.toISOString(),
      timezone: "Europe/Berlin",
      distanceKm: Math.round(S.distanceKm * 100) / 100,
      drivingDurationMinutes: S.drivingMin,
      waitMinutes: totalWait(),
      durationMinutes: durationMin,
      waitFee: waitFee(),
      longTrip: S.distanceKm > C.LONG_TRIP_THRESHOLD_KM,
      routeSource: S.routeSource,
      serviceAreaId: S.areaId,
      language: window.DD_LANG || "en"
    };
  }

  el.book.addEventListener("click", function (e) {
    e.preventDefault();
    if (!S.pickup || !S.destination || !el.date.value || !el.time.value || S.distanceKm == null) {
      showMessage(T("bk.err.incomplete"), "error"); return;
    }
    if (!timeIsValid()) { showMessage(T("bk.err.notice"), "error"); return; }
    if (!checkArea(true)) return;
    var trip = buildTripPayload();
    try { sessionStorage.setItem("ddBookingTrip", JSON.stringify(trip)); } catch (err) {}
    document.dispatchEvent(new CustomEvent("dd:open-booking", { detail: trip }));
  });

  /* ==========================================================
     Start
     ========================================================== */
  document.getElementById("ddbRouteForm").addEventListener("submit", function (e) { e.preventDefault(); });
  attachAutocomplete(el.pickup, el.pickupList, setPickup);
  attachAutocomplete(el.dest, el.destList, setDestination);
  el.pickupClear.addEventListener("click", function () { el.pickup.value = ""; setPickup(null); el.pickup.focus(); });
  el.destClear.addEventListener("click", function () { el.dest.value = ""; setDestination(null); el.dest.focus(); });
  el.addStop.addEventListener("click", addStop);
  el.modePickup.addEventListener("click", function () { setMode("pickup"); });
  el.modeDest.addEventListener("click", function () { setMode("destination"); });
  el.alert.querySelectorAll("[data-close-alert]").forEach(function (b) { b.addEventListener("click", hideAlert); });

  // date: today or later; time: default = next full half hour after the minimum notice
  var earliest = new Date(Date.now() + C.MIN_NOTICE_MINUTES * 60000);
  earliest.setMinutes(Math.ceil(earliest.getMinutes() / 30) * 30, 0, 0);
  el.date.min = localDateValue(new Date());
  el.date.value = localDateValue(earliest);
  el.time.value = pad(earliest.getHours()) + ":" + pad(earliest.getMinutes());
  [el.date, el.time].forEach(function (i) {
    i.addEventListener("change", function () {
      if (el.date.value && el.time.value && !timeIsValid()) showMessage(T("bk.err.notice"), "error");
      else if (el.message.classList.contains("is-error")) showMessage("", "");
      updateBookButton();
    });
  });

  document.addEventListener("dd:langchange", function () {
    renderStops(); setMode(S.mode); updateResult();
    if (el.map.querySelector(".ddb-map-error")) el.map.querySelector(".ddb-map-error").textContent = T("bk.err.mapLoad");
  });

  setMode("pickup");
  updateResult();
  updateStopSummary();
  initMap().then(loadAreas);

  // for the checkout step and debugging
  window.DDBookingRoute = { getTrip: function () { return S.pickup && S.destination ? buildTripPayload() : null; } };
})();
