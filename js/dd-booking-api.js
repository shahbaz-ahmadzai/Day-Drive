/*
 * Day Drive Service – booking settings + backend connection
 * ---------------------------------------------------------
 * This is the ONLY booking file that talks to the backend (Supabase Edge Function "public-booking").
 * The website never writes to the database directly: service areas, free vehicles and prices
 * all come from the server, and the server re-checks everything when a booking is saved.
 *
 * Payment mode is set in the admin panel (Settings → Booking rules):
 *   "pay_on_ride" – booking is confirmed at once, the customer pays the chauffeur (live now)
 *   "online"      – customer pays online first (PayPal / Apple Pay / card) – after PayPal is connected
 * The exact values each function sends and receives are listed in BOOKING-BACKEND.md.
 */
(function () {
  "use strict";

  var CONFIG = {
    // Supabase project of Day Drive (the publishable key is meant to be public)
    SUPABASE_URL: "https://fhvfzmbopjfldugnsoju.supabase.co",
    SUPABASE_KEY: "sb_publishable_3k0F_L47Hltmk3bOq877cg_dkpMq_pK",

    // Google Maps (Maps JavaScript API + Places API (New) + Routes API)
    // Restrict this key in Google Cloud to your website addresses (HTTP referrers).
    GOOGLE_MAPS_API_KEY: "AIzaSyCacZqlH-aeLD4XtNYu0o3shrMEDB2SolU",

    CURRENCY: "EUR",
    COUNTRY_CODES: ["de"],                     // address search limited to Germany
    MAP_CENTER: { lat: 50.1109, lng: 8.6821 }, // Frankfurt am Main
    MAP_ZOOM: 10,

    // defaults – replaced by the values from the admin panel when the page loads
    PAYMENT_MODE: "pay_on_ride",
    BOOKING_ENABLED: true,
    MIN_NOTICE_MINUTES: 60,
    PAYMENT_HOLD_MINUTES: 15,
    MAX_STOPS: 5,
    DEFAULT_WAIT_MINUTES: 5,
    MAX_WAIT_MINUTES: 240,
    WAIT_RATE_PER_MINUTE: 0.25,     // only for the waiting-fee preview – the real price comes from the server
    LONG_TRIP_THRESHOLD_KM: 80,
    LONG_TRIP_MULTIPLIER: 1.5
  };

  /* one POST to the booking function; always resolves to the JSON or throws a readable Error */
  async function call(action, body) {
    var res, data;
    try {
      res = await fetch(CONFIG.SUPABASE_URL + "/functions/v1/public-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_KEY, Authorization: "Bearer " + CONFIG.SUPABASE_KEY },
        body: JSON.stringify(Object.assign({ action: action }, body || {}))
      });
    } catch (e) {
      throw new Error(window.ddT ? window.ddT("bk.err.server") : "The booking service is not reachable.");
    }
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok || !data || data.success === false) {
      var err = new Error((data && data.error) || (window.ddT ? window.ddT("bk.err.server") : "Booking service error"));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  var API = {
    config: CONFIG,

    /**
     * 1) Service areas shown on the map + booking rules from the admin panel.
     * returns { success, bookingEnabled, companies: [{ id, name, latitude, longitude, pickup_radius_km }], rules }
     */
    getBookingConfig: async function () {
      var cfg = await call("config");
      var r = cfg.rules || {};
      if (r.minNoticeMinutes != null) CONFIG.MIN_NOTICE_MINUTES = Number(r.minNoticeMinutes);
      if (r.paymentHoldMinutes != null) CONFIG.PAYMENT_HOLD_MINUTES = Number(r.paymentHoldMinutes);
      if (r.maxStops != null) CONFIG.MAX_STOPS = Number(r.maxStops);
      if (r.waitRatePerMinute != null) CONFIG.WAIT_RATE_PER_MINUTE = Number(r.waitRatePerMinute);
      if (r.longTripKm != null) CONFIG.LONG_TRIP_THRESHOLD_KM = Number(r.longTripKm);
      if (r.longTripMultiplier != null) CONFIG.LONG_TRIP_MULTIPLIER = Number(r.longTripMultiplier);
      CONFIG.PAYMENT_MODE = r.paymentMode === "online" ? "online" : "pay_on_ride";
      CONFIG.BOOKING_ENABLED = cfg.bookingEnabled !== false;
      document.dispatchEvent(new CustomEvent("dd:booking-config", { detail: CONFIG }));
      return cfg;
    },

    /**
     * 2) Free vehicles with their final price for this trip (calculated on the server).
     * returns { vehicles: [{ id, name, category, seats, luggage, image_url, description, price, currency }] }
     */
    getAvailableVehicles: async function (trip) {
      var res = await call("vehicles", { trip: trip });
      return {
        vehicles: (res.vehicles || []).map(function (v) {
          return Object.assign({}, v, { icon: v.seats >= 5 ? "van" : "car" });
        })
      };
    },

    /**
     * 3) Save the booking. The server re-checks availability and uses ITS price.
     * returns { bookingId, bookingReference, clientToken, amount, currency, status, paymentStatus,
     *           paymentMode, paymentExpiresAt, rideCode, bookingStart, smsQueued }
     */
    createBooking: async function (booking) {
      return call("create", { booking: booking });
    },

    /**
     * 4) + 5) Online payment (PayPal / Apple Pay / card) – only used when PAYMENT_MODE is "online".
     * Will call the PayPal functions once PayPal is connected (see BOOKING-BACKEND.md).
     */
    createPaymentOrder: async function () {
      throw new Error("Online payment is not connected yet.");
    },
    capturePayment: async function () {
      throw new Error("Online payment is not connected yet.");
    },

    /**
     * 6) Release a reserved (unpaid, online-payment) booking when the customer closes the payment
     *    window or the reservation time runs out. Needs the clientToken from createBooking.
     */
    cancelPendingBooking: async function (info) {
      if (!info || !info.bookingId || !info.clientToken) return { success: true, released: false };
      try { return await call("cancel", info); } catch (e) { console.warn("cancelPendingBooking", e); return { success: false }; }
    }
  };

  window.DDBookingAPI = API;
})();
