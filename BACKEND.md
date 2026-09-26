# Day Drive – Backend (Supabase) and the new screens

Project: `fhvfzmbopjfldugnsoju` · Region EU · All times Europe/Berlin.
Everything in `supabase/migrations/` is exactly what runs in the live database (secrets replaced by placeholders).
Edge functions are in `supabase/functions/`.

This file describes the backend for the **driver app, customer area ("My Day Drive"), ride page with chat,
regular / monthly rides with deposit balance, ESP32 car starter and push notifications**.
The screens for these parts come next; the admin panel and the website booking already run live.

---

## 1. Logins (no passwords for drivers and customers)

| Who | How | Edge function |
|---|---|---|
| Admin | username + password (Supabase Auth, `username@admin.day-drive.local`) | – |
| Driver | username + 4–6 digit PIN, 5 wrong tries → 15 min locked | `driver-auth` |
| Customer | mobile number → 6-digit SMS code (10 min) | `customer-auth` |

Both functions return `{ email, token_hash }`. The app then calls
`supabase.auth.verifyOtp({ token_hash, type: "magiclink" })` and has a normal Supabase session.

`driver-auth`
- `{ action:"login", username, pin }`
- `{ action:"set_pin", driverId, pin, username?, enabled? }` – admin/owner JWT only; easy PINs (1234, 0000 …) are refused
- `{ action:"disable", driverId }` – admin/owner

`customer-auth`
- `{ action:"request", phone, language? }` – same answer for known and unknown numbers
- `{ action:"verify", phone, code }`

A customer record is created automatically for every booking (matched by e-mail, else by phone),
so everybody who has booked can log in.

---

## 2. Driver app – database functions (RPC, logged-in driver)

| Function | What it does |
|---|---|
| `driver_me()` | profile, open shift, default vehicle, rides today |
| `driver_start_shift(vehicle_id, odometer_km, lat, lng)` | opens the shift (one per driver, one per car) → returns shift + **unlock token** for the ESP32 |
| `driver_unlock_token()` | new unlock token during an open shift |
| `driver_add_expense(category, amount, receipt_path, note, vendor, payment_method, fuel_liters, odometer_km, no_receipt_reason, vat_rate)` | expense at any time; receipt photo in Storage `receipts/drivers/<driver_id>/…` |
| `driver_my_expenses(days)` | own expenses |
| `driver_my_rides(days)` | own rides (customer name shortened, unread chat count) |
| `driver_ride_action(booking_id, action, code, collected_method, collected_amount, note)` | `accept`, `on_the_way`, `arrived`, `picked_up` (checks the 4-digit ride code), `complete` (cash / card / none), `no_show` (after 10 min waiting), `release` |
| `driver_end_shift(uber, bolt, other_platform, cash, card, odometer_km, note, lat, lng)` | closes the shift, writes Uber / Bolt / cash / card income into finance → summary + **lock token** |
| `driver_shift_summary(shift_id)` | km, time, earnings, expenses, missing receipts |
| `driver_report_vehicle_event(type, data)` | what the car answered over Bluetooth (unlocked, engine_on, start_blocked …) |

Cash and card collected for Day Drive rides are booked automatically as income (finance, GoBD).

---

## 3. ESP32 car starter

Every car gets one device: `admin_register_device(vehicle_id, device_uid, mode 'ble'|'lte')`.
It returns the **secret once** – it is flashed into the ESP32 and never shown again.

**Bluetooth (no internet needed in the car)**
The app gets a token from `driver_start_shift` / `driver_unlock_token` and sends it to the ESP32:

```
token = base64url(payload) + "." + hex(HMAC_SHA256(secret, base64url(payload)))
payload = {"v":1,"dev":"<device_uid>","act":"unlock"|"lock","shift":"<id>","iat":<unix>,"exp":<unix+600>,"n":"<random>"}
```
The ESP32 checks the signature, `dev`, `exp` (10 min) and that `n` was not used before, then switches the relay.

**Internet (LTE / Wi-Fi) – edge function `vehicle-device`**
```
POST { device_uid, ts, payload: "<JSON string>", sig }
sig = hex(HMAC_SHA256(secret, device_uid + "|" + ts + "|" + payload))
→ { ok, allowed, shift_id, driver, server_ts, poll_seconds }
```
`allowed = true` only while a driver has an open shift in this car. Events in the payload
(`{"events":[{"type":"engine_on","ts":…}]}`) go into the vehicle activity log (`vehicle_events`).

---

## 4. Customer area – "My Day Drive" (logged-in customer)

| Function | What it does |
|---|---|
| `customer_overview()` | profile, balance, held, available, counts, next ride, contracts |
| `customer_bookings(tab, limit, offset)` | `pending` (not confirmed), `upcoming`, `unpaid`, `history` (rides had) |
| `customer_cancel_booking(booking_id, reason)` | free cancellation before the ride starts |
| `customer_ledger_list(limit)` | deposit account statement |
| `customer_balance_for_booking()` | may this customer pay a new ride from the balance? (available, discount) |
| `send_ride_message(booking_id, text)` / `mark_ride_messages_read(booking_id)` | chat with the driver |

**Ride page without login** (link in the SMS, `ride.html?b=<id>&t=<token>`):
`ride_page(booking_id, token)` and `ride_page_send(booking_id, token, text)`.
Calling will use free WebRTC later (no Twilio costs).

---

## 5. Regular / monthly rides (school, work)

Edge function `regular-rides`:
- `{ action:"quote", plan }` → ride days, number of rides, starting price per car
- `{ action:"request", plan, customer, offer?, termsAccepted }` → request `DD-R-0001` …, office gets an SMS

`plan = { tripType one_way|round_trip, pickups[{address,lat,lng,time,label}] (1–6), destination, returnTime,
startDate, endDate, weekdays [1..7], weekdayTimes {"5":{"return":"12:30"}}, excludedDates, skipPublicHolidays,
skipSchoolHolidays, vehicleId, passengers, luggage, childSeats, children[], notes, purpose school|work|other }`

Flow: **request → (negotiating) → approved → active → paused / ended**

| Admin | Customer |
|---|---|
| `admin_contract_offer(id, price, note)` | `customer_contract(id)` |
| `admin_activate_contract(id, vehicle, driver, price)` → creates all rides | `customer_contract_offer(id, price, note)` |
| `admin_contract_status(id, paused/active/ended/declined, from, reason)` | `customer_accept_offer(offer_id)` |
| `admin_contract_reassign(id, vehicle, driver, from)` | `customer_pause_contract(id, from, to)` / `customer_withdraw_contract(id)` |

Starting price per ride = distance × `vehicles.regular_price_per_km` (falls back to the normal price per km),
at least `regular_minimum_fare`. Single days can be cancelled free of charge.
Public holidays Hessen 2026–2028 are loaded (`holidays`); **school holidays still need to be entered**.

---

## 6. Deposit balance

- `admin_record_deposit(customer, amount, method bank_transfer|cash|card|paypal|other, reference, contract, date)`
  → ledger + finance income "prepaid"
- `admin_refund_balance(…)`, `admin_customer_balance(customer)`
- The ledger can't be edited or deleted (GoBD). Every completed contract ride is charged automatically
  (no-show too, if `charge_no_show` is on for the contract).
- **Extra rides from the balance:** on the website the customer chooses "pay from my balance" (logged in).
  `public-booking` checks the available amount and gives the contract discount.
  available = balance − rides already booked but not driven.

---

## 7. Push notifications (free, Web Push)

Database triggers → `private.notify_event` → edge function `push-send` (protected by an internal secret) → phone.
- Driver: new ride, ride changed, cancelled, removed, new chat message
- Customer: driver assigned, on the way, arrived, new chat message
- Texts in German, English, Arabic, Pashto and Dari.

App side: `push_public_key()` (VAPID key) and `push_subscribe(endpoint, p256dh, auth, audience driver|customer|admin)`.

---

## 8. Security

- Row Level Security on every table; drivers see only their own rides, shifts and receipts; customers only their own data.
- Functions that need a login can't be called without one (migration 14); PIN check, SMS codes, device API and
  secrets are server-only.
- Secrets (Twilio, VAPID, internal secret, device secrets) are stored in Supabase Vault or a private schema, never in the website.

## 9. Screens (built on this backend)

| Screen | Address | Who |
|---|---|---|
| Driver app (home-screen web app, 5 languages) | `driver/` | drivers – username + PIN |
| My Day Drive | `account.html` | customers – SMS code |
| Ride page with ride code + chat | `ride.html?b=…&t=…` (link in the SMS / after booking) | customers, no login |
| Monthly rides request | `monthly.html` | everyone |
| Pay from balance | `booking.html` (shown when logged in to My Day Drive) | customers with balance |
| Admin: Monthly rides, Customers (balance), Shifts | `admin/#/contracts`, `#/customers`, `#/shifts` | office |
| Admin: driver app access (PIN) | Drivers → driver → "Driver app" | owner/admin |
| Admin: starter box, car log, monthly prices | Vehicles → car → "Starter box" / "Car log" / Edit | owner/admin |
| Admin: school holidays | Settings → Holidays | owner/admin |
| Admin: chat with customer + driver | Bookings → booking → "Chat" | office |

Bluetooth contract for the ESP32 (used by the driver app, Android Chrome today, iPhone app later):
service `d4d10001-7c3a-4a8e-9b2f-5a1e0c0d0001`, write the token to characteristic `d4d10002-…0001`,
status notifications on `d4d10003-…0001`. The box advertises its `device_uid` as Bluetooth name.
iPhone Safari has no Web Bluetooth – there the box works over LTE, or with the TestFlight app later.

Push on iPhone works only when the app is opened from the home-screen icon (iOS 16.4+).

## 10. Still open

- School holidays for Hessen (admin → holidays)
- Default "charge a no-show on contracts" = on – confirm
- Set `regular_price_per_km` / `regular_minimum_fare` per car for monthly rides
- Screens: driver app (PWA → TestFlight), My Day Drive, ride page, monthly-ride form, admin pages for contracts,
  balances, shifts, devices, driver PINs
- E-mail codes after Resend is set up on daydriveservice.de
