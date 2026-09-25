# Day Drive booking – backend reference

The booking page (`booking.html`) talks to **one** Supabase Edge Function: `public-booking`
(project *Day-Drive*, `https://fhvfzmbopjfldugnsoju.supabase.co/functions/v1/public-booking`).
All calls are `POST` with JSON and the headers `apikey` + `Authorization: Bearer <publishable key>`.
Every answer has `success: true` or `success: false` + `error` (readable text).

The browser never writes to the database. The function checks the service area, the minimum notice,
free vehicles (with buffer) and **calculates the price itself**.

## Booking flow

1. Page loads → `config` (service areas + rules from the admin panel)
2. Customer enters route + time → `vehicles` (free vehicles with server prices)
3. Customer fills the form → `create`
   - payment mode **pay_on_ride** (live now): booking `confirmed`, payment `cash_on_ride`,
     SMS to the customer + "new booking" SMS to the office → confirmation window
   - payment mode **online** (after PayPal): booking `pending_payment`, vehicle held for *payment_hold_minutes* → payment window
4. Online mode only: customer closes the payment window / time runs out → `cancel`

## 1. `{ action: "config" }`

```json
{ "success": true, "bookingEnabled": true,
  "companies": [{ "id": "…", "name": "Frankfurt am Main", "latitude": 50.1109, "longitude": 8.6821, "pickup_radius_km": 60 }],
  "rules": { "minNoticeMinutes": 60, "paymentHoldMinutes": 15, "maxStops": 5, "waitRatePerMinute": 0.25,
             "longTripKm": 80, "longTripMultiplier": 1.5, "paymentMode": "pay_on_ride" } }
```
`bookingEnabled` = Admin → Settings → Company → "Accept bookings on the website".

## 2. `{ action: "vehicles", trip }`

`trip` (built in `dd-booking-map.js`):

| Field | Example |
|-------|---------|
| `pickup`, `destination` | `{ address, lat, lng, placeId }` |
| `stops` | `[{ address, lat, lng, placeId, waitMinutes }]` (max. *maxStops*) |
| `bookingStart` | ISO time, e.g. `2026-10-02T07:30:00.000Z` |
| `distanceKm`, `drivingDurationMinutes` | from Google Routes (server never accepts less than the straight line) |
| `routeSource` | `google` or `estimate` |
| `language` | `de` / `en` |

Answer: `{ vehicles: [{ id, name, category, seats, luggage, image_url, description, price, currency }] }`, cheapest first.

**Price** = max(km × price per km, minimum fare) + waiting minutes × wait rate + airport fee (FRA ±3 km)
→ × (1 + night surcharge %) at night → × long-trip factor above *longTripKm*. All values are set in the admin panel.

## 3. `{ action: "create", booking }`

```json
{ "trip": { …as above… },
  "vehicle": { "id": "…" },
  "customer": { "firstName": "Max", "lastName": "Mustermann", "email": "max@example.com", "phone": "0170 1234567",
                "flightNumber": "LH400", "passengers": 2, "luggage": 1, "notes": "child seat" },
  "serviceType": "airport_transfer", "termsAccepted": true }
```
Answer:
```json
{ "success": true, "bookingId": "…", "bookingReference": "DD-261002-0001", "clientToken": "…",
  "amount": 55, "currency": "EUR", "status": "confirmed", "paymentStatus": "cash_on_ride",
  "paymentMode": "pay_on_ride", "paymentExpiresAt": null, "rideCode": "4821", "bookingStart": "…", "smsQueued": true }
```
Protection: max. 3 website bookings per e-mail / phone within 30 minutes.

## 4. `{ action: "cancel", bookingId, clientToken, reason: "closed" | "expired" }`

Only releases **unpaid online** bookings (`pending_payment`). Confirmed bookings are cancelled in the admin panel.

## Other functions

| Function | Called by | Purpose |
|----------|-----------|---------|
| `booking-sms` | admin panel, `public-booking` | `{ bookingId, template: "confirmation" \| "admin_alert" }`, `{ template: "test", phone }` |
| `admin-login` | admin sign-in | `{ login }` → e-mail behind a username |
| `admin-users` | Settings → Team (owner only) | create / set_role / set_active / reset_password |

## Still to do for online payment (PayPal)

1. Day Drive's PayPal business account → Client ID + Secret (stored in Supabase Vault).
2. Functions `paypal-create-order` / `paypal-capture` (amount always taken from the booking in the database).
3. Connect `createPaymentOrder` / `capturePayment` in `js/dd-booking-api.js`.
4. Admin → Settings → Booking rules → Payment → "Pay online".
