/*
 * Day Drive Service – booking page, steps 2 + 3
 * Vehicle window (available vehicles + customer form) and payment window.
 * Opens when dd-booking-map.js sends the event "dd:open-booking".
 */
(function () {
  "use strict";

  var API = window.DDBookingAPI;
  var C = API.config;
  var T = function (k, v) { return window.ddT ? window.ddT(k, v) : k; };
  var $ = function (id) { return document.getElementById(id); };
  var icon = function (n, cls) { return window.icon ? window.icon(n, cls) : ""; };

  var el = {
    vModal: $("ddbVehicleModal"),
    sPickup: $("ddbSumPickup"), sDest: $("ddbSumDestination"), sStops: $("ddbSumStops"),
    sDate: $("ddbSumDate"), sTime: $("ddbSumTime"), sDist: $("ddbSumDistance"), sDur: $("ddbSumDuration"),
    count: $("ddbVehicleCount"), loading: $("ddbVehicleLoading"), empty: $("ddbVehicleEmpty"), list: $("ddbVehicleList"),
    form: $("ddbCustomerForm"),
    service: $("ddbService"), first: $("ddbFirstName"), last: $("ddbLastName"), email: $("ddbEmail"), phone: $("ddbPhone"),
    flight: $("ddbFlight"), passengers: $("ddbPassengers"), luggage: $("ddbLuggage"), notes: $("ddbNotes"), terms: $("ddbTerms"),
    selBox: $("ddbSelected"), selName: $("ddbSelectedName"), selPrice: $("ddbSelectedPrice"),
    formMsg: $("ddbFormMessage"), cont: $("ddbContinue"),
    overlay: $("ddbOverlay"),
    pModal: $("ddbPaymentModal"),
    pVehicle: $("ddbPayVehicle"), pAmount: $("ddbPayAmount"), pCountdown: $("ddbPayCountdown"), pRef: $("ddbPayRef"),
    pMsg: $("ddbPayMessage"), pPayPal: $("ddbPayPayPal"), pApple: $("ddbPayApple"), pCard: $("ddbPayCard"),
    vKicker: $("ddbVKicker"), payNote: $("ddbPayNote"),
    dModal: $("ddbDoneModal"), dTitle: $("ddbDTitle"), dLead: $("ddbDoneLead"), dRef: $("ddbDoneRef"), dWhen: $("ddbDoneWhen"),
    dVehicle: $("ddbDoneVehicle"), dRoute: $("ddbDoneRoute"), dAmount: $("ddbDoneAmount"), dAgain: $("ddbDoneAgain")
  };
  var payOnRide = function () { return C.PAYMENT_MODE !== "online"; };

  var S = { trip: null, vehicles: [], selected: null, booking: null, timer: null, run: 0 };

  function locale() { return window.DD_LANG === "de" ? "de-DE" : "en-GB"; }
  function money(v) {   // number only, e.g. 41.75 / 41,75
    return Number(v || 0).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function price(v) {   // with currency, e.g. €41.75 / 41,75 €
    return window.DD_LANG === "de" ? money(v) + " €" : "€" + money(v);
  }
  function km(v) { return Number(v).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " km"; }
  function formatDate(value) {
    var d = new Date(value + "T00:00:00");
    if (isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat(window.DD_LANG === "de" ? "de-DE" : "en-GB",
      { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  }
  function formatDuration(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return h ? h + " h " + String(m).padStart(2, "0") + " min" : m + " min";
  }
  function openDialog(d) {
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else d.setAttribute("open", "");
    document.body.classList.add("modal-open");
  }
  function closeDialog(d) {
    if (d.open) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
    if (!el.vModal.open && !el.pModal.open && !el.dModal.open) document.body.classList.remove("modal-open");
  }
  /* texts that depend on the payment mode (set in the admin panel) */
  function applyMode() {
    var key = payOnRide() ? "bk.v.kicker2" : "bk.v.kicker";
    el.vKicker.setAttribute("data-i18n", key);
    el.vKicker.textContent = T(key);
    var lead = $("ddbVLead"), lk = payOnRide() ? "bk.v.lead2" : "bk.v.lead";
    if (lead) { lead.setAttribute("data-i18n", lk); lead.textContent = T(lk); }
    el.payNote.hidden = !payOnRide();
    updateContinue();
  }
  /* server messages are English – show the translated text where we know it */
  function friendlyError(err) {
    var m = (err && err.message) || "";
    if (/just been booked/i.test(m)) return T("bk.e.gone");
    if (/outside our service area/i.test(m)) return T("bk.area.text");
    if (/at least \d+ minutes/i.test(m)) return T("bk.err.notice");
    if (/several bookings/i.test(m)) return T("bk.e.tooMany");
    if (/paused/i.test(m)) return T("bk.err.paused");
    return m || T("bk.err.server");
  }
  function formMessage(text, type) {
    el.formMsg.textContent = text || "";
    el.formMsg.className = "ddb-form-message" + (type ? " is-" + type : "");
  }

  /* ==========================================================
     Step 2 – vehicle window
     ========================================================== */
  function fillSummary() {
    var t = S.trip;
    el.sPickup.textContent = t.pickup.address;
    el.sDest.textContent = t.destination.address;
    el.sStops.textContent = t.stops.length
      ? t.stops.map(function (s, i) { return (i + 1) + ". " + s.address + " (" + s.waitMinutes + " " + T("bk.stop.min") + ")"; }).join(" · ")
      : T("bk.v.noStops");
    el.sDate.textContent = formatDate(t.bookingDate);
    el.sTime.textContent = t.bookingTime;
    el.sDist.textContent = km(t.distanceKm) + (t.routeSource === "estimate" ? " (" + T("bk.estimated") + ")" : "");
    el.sDur.textContent = formatDuration(t.durationMinutes);
  }

  async function openVehicleStep(trip) {
    S.trip = trip; S.selected = null; S.vehicles = [];
    fillSummary();
    resetSelection();
    formMessage("");
    openDialog(el.vModal);
    el.vModal.querySelector(".ddb-modal-body").scrollTop = 0;
    await loadVehicles();
  }

  async function loadVehicles() {
    var my = ++S.run;
    el.loading.hidden = false; el.empty.hidden = true; el.list.innerHTML = "";
    el.count.textContent = T("bk.v.checking");
    try {
      var res = await API.getAvailableVehicles(S.trip);
      if (my !== S.run) return;
      S.vehicles = (res && res.vehicles) || [];
      renderVehicles();
    } catch (e) {
      console.error("Vehicle loading error:", e);
      el.count.textContent = T("bk.v.loadError");
      el.empty.hidden = false;
      formMessage(friendlyError(e), "error");
    } finally {
      if (my === S.run) el.loading.hidden = true;
    }
  }

  function renderVehicles() {
    var passengers = Number(el.passengers.value) || 1;
    el.count.textContent = T("bk.v.count", { n: S.vehicles.length });
    el.empty.hidden = S.vehicles.length > 0;
    el.list.innerHTML = S.vehicles.map(function (v) {
      var tooSmall = v.seats && passengers > v.seats;
      var isSel = S.selected && S.selected.id === v.id;
      var media = v.image_url
        ? '<img src="' + v.image_url + '" alt="' + v.name + '" loading="lazy">'
        : icon(v.icon || "car", "ddb-vehicle-icon");
      return '<article class="ddb-vehicle' + (isSel ? " is-selected" : "") + (tooSmall ? " is-disabled" : "") + '" data-id="' + v.id + '">' +
        '<div class="ddb-vehicle-media' + (v.image_url ? " has-photo" : "") + '">' + media + "</div>" +
        '<div class="ddb-vehicle-body">' +
        '<button type="button" class="ddb-vehicle-select"' + (tooSmall ? " disabled" : "") + ">" +
        (tooSmall ? T("bk.v.tooSmall") : isSel ? icon("check") + T("bk.v.selected") + " · " + price(v.price) : T("bk.v.select", { price: money(v.price) })) +
        "</button>" +
        '<div class="ddb-vehicle-info">' +
        "<h4>" + v.name + "</h4>" +
        (v.category ? '<p class="ddb-vehicle-cat">' + v.category + "</p>" : "") +
        '<ul class="ddb-vehicle-specs">' +
        (v.seats ? "<li>" + icon("users") + T("bk.v.seats", { n: v.seats }) + "</li>" : "") +
        (v.luggage ? "<li>" + icon("briefcase") + T("bk.v.luggage", { n: v.luggage }) + "</li>" : "") +
        "</ul></div></div></article>";
    }).join("");
    el.list.querySelectorAll(".ddb-vehicle").forEach(function (card) {
      var btn = card.querySelector(".ddb-vehicle-select");
      btn.addEventListener("click", function () {
        selectVehicle(S.vehicles.find(function (v) { return v.id === card.dataset.id; }));
      });
    });
  }

  function selectVehicle(v) {
    if (!v) return;
    S.selected = v;
    renderVehicles();
    el.selBox.hidden = false;
    el.selName.textContent = v.name;
    el.selPrice.textContent = price(v.price);
    updateContinue();
    formMessage("");
  }
  function resetSelection() {
    S.selected = null;
    el.selBox.hidden = true;
    el.selName.textContent = "—"; el.selPrice.textContent = "—";
    updateContinue();
  }
  function updateContinue() {
    el.cont.disabled = !S.selected;
    el.cont.textContent = S.selected ? T(payOnRide() ? "bk.c.book" : "bk.c.continue", { price: money(S.selected.price) }) : T("bk.c.selectFirst");
  }

  /* ---------- customer form ---------- */
  function setError(id, text) { var e = $(id); if (e) e.textContent = text || ""; }
  function validate() {
    ["ddbErrFirst", "ddbErrLast", "ddbErrEmail", "ddbErrPhone"].forEach(function (id) { setError(id, ""); });
    var ok = true, firstBad = null;
    function bad(input, errId, key) { setError(errId, T(key)); ok = false; firstBad = firstBad || input; }
    if (!el.first.value.trim()) bad(el.first, "ddbErrFirst", "bk.e.first");
    if (!el.last.value.trim()) bad(el.last, "ddbErrLast", "bk.e.last");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.email.value.trim())) bad(el.email, "ddbErrEmail", "bk.e.email");
    if (el.phone.value.replace(/[^\d]/g, "").length < 6) bad(el.phone, "ddbErrPhone", "bk.e.phone");
    if (ok && !el.terms.checked) { formMessage(T("bk.e.terms"), "error"); ok = false; firstBad = el.terms; }
    if (firstBad) firstBad.focus();
    return ok;
  }

  /* all values sent to createBooking() – see BOOKING-BACKEND.md */
  function buildBookingPayload() {
    return {
      trip: S.trip,
      vehicle: { id: S.selected.id, name: S.selected.name },
      price: { amount: S.selected.price, currency: C.CURRENCY },
      customer: {
        firstName: el.first.value.trim(),
        lastName: el.last.value.trim(),
        email: el.email.value.trim().toLowerCase(),
        phone: el.phone.value.trim(),
        flightNumber: el.flight.value.trim().toUpperCase() || null,
        passengers: Number(el.passengers.value) || 1,
        luggage: Number(el.luggage.value) || 0,
        notes: el.notes.value.trim() || null
      },
      serviceType: el.service.value,
      termsAccepted: el.terms.checked,
      language: window.DD_LANG || "en",
      source: "website"
    };
  }

  el.form.addEventListener("submit", async function (e) {
    e.preventDefault();
    formMessage("");
    if (!S.selected) { formMessage(T("bk.e.vehicle"), "error"); return; }
    if (!validate()) return;
    el.cont.disabled = true; el.cont.textContent = T("bk.c.saving");
    el.overlay.hidden = false;
    try {
      // the server checks again that the vehicle is still free and calculates the final price
      var payload = buildBookingPayload();
      var res = await API.createBooking(payload);
      S.booking = Object.assign({}, res, { vehicleName: S.selected.name, customer: payload.customer, trip: S.trip });
      try { sessionStorage.setItem("ddBooking", JSON.stringify({ reference: res.bookingReference, bookingId: res.bookingId })); } catch (err) {}
      el.overlay.hidden = true;
      closeDialog(el.vModal);
      if (res.status === "pending_payment") openPayment();
      else openDone();
    } catch (err) {
      console.error("Booking error:", err);
      el.overlay.hidden = true;
      formMessage(friendlyError(err), "error");
      updateContinue();
      if (/just been booked/i.test(err.message || "")) { resetSelection(); loadVehicles(); }
    }
  });

  el.passengers.addEventListener("change", function () {
    var p = Number(el.passengers.value) || 1;
    if (S.selected && S.selected.seats && p > S.selected.seats) resetSelection();
    renderVehicles();
  });
  el.terms.addEventListener("change", function () { if (el.terms.checked) formMessage(""); });
  [["ddbFirstName", "ddbErrFirst"], ["ddbLastName", "ddbErrLast"], ["ddbEmail", "ddbErrEmail"], ["ddbPhone", "ddbErrPhone"]].forEach(function (p) {
    $(p[0]).addEventListener("input", function () { setError(p[1], ""); });
  });

  /* ==========================================================
     Step 3 – payment window
     ========================================================== */
  function openPayment() {
    var b = S.booking;
    el.pVehicle.textContent = b.vehicleName;
    el.pAmount.textContent = price(b.amount);
    el.pRef.textContent = b.bookingReference || "—";
    el.pMsg.textContent = ""; el.pMsg.className = "ddb-pay-message";
    [el.pPayPal, el.pApple, el.pCard].forEach(function (x) { x.disabled = false; });
    // Apple Pay only shows on Apple devices that support it
    el.pApple.hidden = !(window.ApplePaySession && window.ApplePaySession.canMakePayments && window.ApplePaySession.canMakePayments());
    openDialog(el.pModal);
    startCountdown(b.paymentExpiresAt);
  }
  function startCountdown(expires) {
    clearInterval(S.timer);
    var end = new Date(expires).getTime();
    function tick() {
      var left = end - Date.now();
      if (!isFinite(left) || left <= 0) {
        clearInterval(S.timer);
        el.pCountdown.textContent = "00:00";
        el.pMsg.textContent = T("bk.p.expired"); el.pMsg.className = "ddb-pay-message is-error";
        [el.pPayPal, el.pApple, el.pCard].forEach(function (x) { x.disabled = true; });
        if (S.booking) API.cancelPendingBooking({ bookingId: S.booking.bookingId, clientToken: S.booking.clientToken, reason: "expired" });
        return;
      }
      var s = Math.floor(left / 1000);
      el.pCountdown.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }
    tick();
    S.timer = setInterval(tick, 1000);
  }
  async function pay(method, label) {
    if (!S.booking) return;
    // online payment (PayPal / Apple Pay / card) is added together with the PayPal connection
    try {
      await API.createPaymentOrder({ bookingId: S.booking.bookingId, clientToken: S.booking.clientToken, amount: Number(S.booking.amount).toFixed(2),
        currency: C.CURRENCY, paymentMethod: method, verificationMethod: method === "card" ? "SCA_WHEN_REQUIRED" : null });
    } catch (e) {
      el.pMsg.textContent = e.message; el.pMsg.className = "ddb-pay-message is-error";
    }
  }

  /* ==========================================================
     Done – booking confirmed (pay on the ride)
     ========================================================== */
  function fillDone() {
    var b = S.booking; if (!b) return;
    var c = b.customer || {}, t = b.trip || {};
    el.dTitle.textContent = T("bk.d.title", { name: c.firstName || "" });
    el.dLead.textContent = b.smsQueued ? T("bk.d.lead", { phone: c.phone || "" }) : T("bk.d.leadNoSms");
    el.dRef.textContent = b.bookingReference || "—";
    el.dWhen.textContent = formatDate(t.bookingDate) + ", " + t.bookingTime + (window.DD_LANG === "de" ? " Uhr" : "");
    el.dVehicle.textContent = b.vehicleName || "—";
    el.dRoute.textContent = (t.pickup ? t.pickup.address : "") + " → " + (t.destination ? t.destination.address : "");
    el.dAmount.textContent = price(b.amount);
  }
  function openDone() {
    fillDone();
    openDialog(el.dModal);
  }
  el.dAgain.addEventListener("click", function () {
    try { sessionStorage.removeItem("ddBookingTrip"); } catch (e) {}
    location.href = "booking.html";
  });

  el.pPayPal.addEventListener("click", function () { pay("paypal", "PayPal"); });
  el.pApple.addEventListener("click", function () { pay("applepay", "Apple Pay"); });
  el.pCard.addEventListener("click", function () { pay("card", T("bk.p.card")); });

  /* ---------- closing ---------- */
  el.vModal.querySelectorAll("[data-ddb-close]").forEach(function (b) { b.addEventListener("click", function () { closeDialog(el.vModal); }); });
  el.pModal.querySelectorAll("[data-ddb-close]").forEach(function (b) { b.addEventListener("click", function () { closeDialog(el.pModal); }); });
  el.dModal.querySelectorAll("[data-ddb-close]").forEach(function (b) { b.addEventListener("click", function () { closeDialog(el.dModal); }); });
  [el.vModal, el.pModal, el.dModal].forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) closeDialog(d); });
    d.addEventListener("close", function () {
      if (!el.vModal.open && !el.pModal.open && !el.dModal.open) document.body.classList.remove("modal-open");
    });
  });
  el.pModal.addEventListener("close", function () {
    clearInterval(S.timer);
    if (S.booking && S.booking.status === "pending_payment") { API.cancelPendingBooking({ bookingId: S.booking.bookingId, clientToken: S.booking.clientToken, reason: "closed" }); S.booking = null; }
  });

  /* ---------- language change ---------- */
  document.addEventListener("dd:langchange", function () {
    if (S.trip) fillSummary();
    if (S.vehicles.length) renderVehicles(); else if (!el.loading.hidden) el.count.textContent = T("bk.v.checking");
    updateContinue();
    if (S.selected) el.selPrice.textContent = price(S.selected.price);
    if (S.booking) el.pAmount.textContent = price(S.booking.amount);
    if (S.booking && el.dModal.open) fillDone();
    applyMode();
  });
  document.addEventListener("dd:booking-config", applyMode);

  document.addEventListener("dd:open-booking", function (e) { openVehicleStep(e.detail); });
  applyMode();
})();
