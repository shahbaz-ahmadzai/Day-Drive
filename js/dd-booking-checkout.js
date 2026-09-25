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
    pMsg: $("ddbPayMessage"), pPayPal: $("ddbPayPayPal"), pApple: $("ddbPayApple"), pCard: $("ddbPayCard")
  };

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
    if (!el.vModal.open && !el.pModal.open) document.body.classList.remove("modal-open");
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
        "<h4>" + v.name + "</h4>" +
        (v.category ? '<p class="ddb-vehicle-cat">' + v.category + "</p>" : "") +
        '<ul class="ddb-vehicle-specs">' +
        (v.seats ? "<li>" + icon("users") + T("bk.v.seats", { n: v.seats }) + "</li>" : "") +
        (v.luggage ? "<li>" + icon("briefcase") + T("bk.v.luggage", { n: v.luggage }) + "</li>" : "") +
        "</ul>" +
        '<button type="button" class="ddb-vehicle-select"' + (tooSmall ? " disabled" : "") + ">" +
        (tooSmall ? T("bk.v.tooSmall") : isSel ? icon("check") + T("bk.v.selected") + " · " + price(v.price) : T("bk.v.select", { price: money(v.price) })) +
        "</button></div></article>";
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
    el.cont.textContent = S.selected ? T("bk.c.continue", { price: money(S.selected.price) }) : T("bk.c.selectFirst");
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
      // check again that the vehicle is still free (someone else could have booked it)
      var fresh = await API.getAvailableVehicles(S.trip);
      var still = (fresh.vehicles || []).find(function (v) { return v.id === S.selected.id; });
      if (!still) throw new Error(T("bk.e.gone"));
      S.selected.price = still.price;
      var payload = buildBookingPayload();
      var res = await API.createBooking(payload);
      S.booking = Object.assign({}, res, { vehicleName: S.selected.name });
      try { sessionStorage.setItem("ddBooking", JSON.stringify({ request: payload, response: res })); } catch (err) {}
      el.overlay.hidden = true;
      closeDialog(el.vModal);
      openPayment();
    } catch (err) {
      console.error("Booking error:", err);
      el.overlay.hidden = true;
      formMessage(err.message || T("bk.v.loadError"), "error");
      updateContinue();
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
        if (S.booking) API.cancelPendingBooking({ bookingId: S.booking.bookingId, reason: "expired" });
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
    if (C.DEMO_MODE) {
      // show what would be sent; real PayPal / Apple Pay / card buttons come with the backend
      await API.createPaymentOrder({ bookingId: S.booking.bookingId, amount: Number(S.booking.amount).toFixed(2),
        currency: C.CURRENCY, paymentMethod: method, verificationMethod: method === "card" ? "SCA_WHEN_REQUIRED" : null });
      el.pMsg.textContent = T("bk.p.demo", { method: label });
      el.pMsg.className = "ddb-pay-message is-info";
      return;
    }
  }
  el.pPayPal.addEventListener("click", function () { pay("paypal", "PayPal"); });
  el.pApple.addEventListener("click", function () { pay("applepay", "Apple Pay"); });
  el.pCard.addEventListener("click", function () { pay("card", T("bk.p.card")); });

  /* ---------- closing ---------- */
  el.vModal.querySelectorAll("[data-ddb-close]").forEach(function (b) { b.addEventListener("click", function () { closeDialog(el.vModal); }); });
  el.pModal.querySelectorAll("[data-ddb-close]").forEach(function (b) { b.addEventListener("click", function () { closeDialog(el.pModal); }); });
  [el.vModal, el.pModal].forEach(function (d) {
    d.addEventListener("click", function (e) { if (e.target === d) closeDialog(d); });
    d.addEventListener("close", function () {
      if (!el.vModal.open && !el.pModal.open) document.body.classList.remove("modal-open");
    });
  });
  el.pModal.addEventListener("close", function () {
    clearInterval(S.timer);
    if (S.booking) { API.cancelPendingBooking({ bookingId: S.booking.bookingId, reason: "closed" }); S.booking = null; }
  });

  /* ---------- language change ---------- */
  document.addEventListener("dd:langchange", function () {
    if (S.trip) fillSummary();
    if (S.vehicles.length) renderVehicles(); else if (!el.loading.hidden) el.count.textContent = T("bk.v.checking");
    updateContinue();
    if (S.selected) el.selPrice.textContent = price(S.selected.price);
    if (S.booking) el.pAmount.textContent = price(S.booking.amount);
  });

  document.addEventListener("dd:open-booking", function (e) { openVehicleStep(e.detail); });
  updateContinue();
})();
