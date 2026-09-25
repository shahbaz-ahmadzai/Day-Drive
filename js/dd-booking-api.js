/*
 * Day Drive Service – booking settings + backend connection
 * ---------------------------------------------------------
 * This is the ONLY booking file that talks to the backend.
 * While DEMO_MODE is true, every function below answers with sample data,
 * so the booking page can be tested without a backend.
 *
 * To connect the real backend later, replace the body of each
 * DDBookingAPI function (look for "BACKEND:") and set DEMO_MODE to false.
 * The exact values each function sends and receives are listed in BOOKING-BACKEND.md.
 */
(function () {
  "use strict";

  var CONFIG = {
    DEMO_MODE: true,

    // Google Maps (Maps JavaScript API + Places API (New) + Routes API)
    // Restrict this key in Google Cloud to your website addresses (HTTP referrers).
    GOOGLE_MAPS_API_KEY: "AIzaSyCacZqlH-aeLD4XtNYu0o3shrMEDB2SolU",

    CURRENCY: "EUR",
    COUNTRY_CODES: ["de"],                     // address search limited to Germany
    MAP_CENTER: { lat: 50.1109, lng: 8.6821 }, // Frankfurt am Main
    MAP_ZOOM: 10,

    MIN_NOTICE_MINUTES: 60,        // earliest pickup = now + 60 min
    PAYMENT_HOLD_MINUTES: 15,      // vehicle reserved while paying
    BOOKING_GAP_MINUTES: 60,       // buffer before/after every booking (availability)
    MAX_STOPS: 5,
    DEFAULT_WAIT_MINUTES: 5,
    MAX_WAIT_MINUTES: 240,

    // DEMO pricing rules (the real price should be calculated by the backend)
    WAIT_RATE_PER_MINUTE: 0.25,
    LONG_TRIP_THRESHOLD_KM: 80,
    LONG_TRIP_MULTIPLIER: 1.5,

    // DEMO service area – replace with the real one from the backend
    DEMO_SERVICE_AREAS: [
      { id: "frankfurt", name: "Frankfurt am Main", latitude: 50.1109, longitude: 8.6821, pickup_radius_km: 60 }
    ],

    // DEMO vehicles – seats, luggage and prices are SAMPLE values, not real Day Drive data
    DEMO_VEHICLES: [
      { id: "e-class", name: "Mercedes-Benz E-Class", category: "VIP · Executive · Business", seats: 3, luggage: 2,
        price_per_km: 2.8, minimum_fare: 55, image_url: "assets/images/fleet-e-class.webp", icon: "car" },
      { id: "touran-2026", name: "VW Touran 2026", category: "Family · Groups", seats: 6, luggage: 4,
        price_per_km: 2.4, minimum_fare: 45, image_url: null, icon: "van" },
      { id: "proace-city-2026", name: "Toyota Proace City 2026", category: "Spacious · Versatile", seats: 4, luggage: 5,
        price_per_km: 2.3, minimum_fare: 45, image_url: null, icon: "van" },
      { id: "corolla-2026", name: "Toyota Corolla 2026", category: "Comfortable · Modern", seats: 4, luggage: 3,
        price_per_km: 2.0, minimum_fare: 35, image_url: null, icon: "car" },
      { id: "c-hr", name: "Toyota C-HR", category: "Modern · Stylish", seats: 4, luggage: 2,
        price_per_km: 2.1, minimum_fare: 38, image_url: null, icon: "car" }
    ]
  };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function round2(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }

  /* DEMO price – same rules as the TOP-TRIP booking page */
  function demoPrice(vehicle, trip) {
    var price = Math.max(trip.distanceKm * vehicle.price_per_km, vehicle.minimum_fare);
    price += (trip.waitMinutes || 0) * CONFIG.WAIT_RATE_PER_MINUTE;
    if (trip.distanceKm > CONFIG.LONG_TRIP_THRESHOLD_KM) price *= CONFIG.LONG_TRIP_MULTIPLIER;
    return round2(price);
  }

  var API = {
    config: CONFIG,

    /**
     * 1) Service areas shown on the map; pickup must be inside one of them.
     * BACKEND: e.g. supabase.functions.invoke("public-booking-config")
     * returns { success: true, companies: [{ id, name, latitude, longitude, pickup_radius_km }] }
     */
    getBookingConfig: async function () {
      if (CONFIG.DEMO_MODE) {
        await wait(150);
        return { success: true, companies: CONFIG.DEMO_SERVICE_AREAS.slice() };
      }
      throw new Error("getBookingConfig: backend not connected yet");
    },

    /**
     * 2) Free vehicles with their final price for this trip.
     * @param trip  see buildTripPayload() in dd-booking-map.js / BOOKING-BACKEND.md
     * BACKEND: check bookings (incl. BOOKING_GAP_MINUTES), calculate prices server-side,
     * return { vehicles: [{ id, name, category, seats, luggage, image_url, price, currency }] }
     */
    getAvailableVehicles: async function (trip) {
      if (CONFIG.DEMO_MODE) {
        await wait(700);
        return {
          vehicles: CONFIG.DEMO_VEHICLES.map(function (v) {
            return Object.assign({}, v, { price: demoPrice(v, trip), currency: CONFIG.CURRENCY });
          }).sort(function (a, b) { return a.price - b.price; })
        };
      }
      throw new Error("getAvailableVehicles: backend not connected yet");
    },

    /**
     * 3) Save the booking as "pending_payment" and reserve the vehicle.
     * @param booking  see buildBookingPayload() in dd-booking-checkout.js / BOOKING-BACKEND.md
     * BACKEND: re-check availability, insert the row,
     * return { bookingId, bookingReference, amount, currency, paymentExpiresAt }
     */
    createBooking: async function (booking) {
      if (CONFIG.DEMO_MODE) {
        await wait(900);
        var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        console.info("[Day Drive demo] createBooking payload:", booking);
        return {
          bookingId: id,
          bookingReference: "DD-" + id.slice(0, 6).toUpperCase(),
          amount: booking.price.amount,
          currency: CONFIG.CURRENCY,
          paymentExpiresAt: new Date(Date.now() + CONFIG.PAYMENT_HOLD_MINUTES * 60000).toISOString()
        };
      }
      throw new Error("createBooking: backend not connected yet");
    },

    /**
     * 4) Create a payment order (PayPal / Apple Pay / card).
     * BACKEND: e.g. PayPal "create order" function
     * send { bookingId, amount, currency, paymentMethod, verificationMethod } → return { orderId }
     */
    createPaymentOrder: async function (payment) {
      if (CONFIG.DEMO_MODE) {
        console.info("[Day Drive demo] createPaymentOrder payload:", payment);
        return { orderId: "DEMO-ORDER" };
      }
      throw new Error("createPaymentOrder: backend not connected yet");
    },

    /**
     * 5) Confirm (capture) the payment after the customer approved it.
     * BACKEND: e.g. PayPal "capture order" function
     * send { bookingId, orderId } → return { status: "COMPLETED", paymentReference, paidAt }
     */
    capturePayment: async function (payment) {
      if (CONFIG.DEMO_MODE) {
        console.info("[Day Drive demo] capturePayment payload:", payment);
        return { status: "COMPLETED", paymentReference: "DEMO", paidAt: new Date().toISOString() };
      }
      throw new Error("capturePayment: backend not connected yet");
    },

    /**
     * 6) Release the reserved vehicle when the customer closes the payment window
     *    or the reservation time runs out.
     * BACKEND: send { bookingId, reason: "closed" | "expired" } → return { success: true }
     */
    cancelPendingBooking: async function (info) {
      if (CONFIG.DEMO_MODE) {
        console.info("[Day Drive demo] cancelPendingBooking payload:", info);
        return { success: true };
      }
      throw new Error("cancelPendingBooking: backend not connected yet");
    }
  };

  window.DDBookingAPI = API;
})();
