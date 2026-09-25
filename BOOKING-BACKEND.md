# Day Drive booking – values for the backend

The booking page (`booking.html`) works on its own in **demo mode**: vehicles, prices and availability are sample data, nothing is saved and no payment is taken.

All backend calls go through **one file**: `js/dd-booking-api.js`.
To go live, replace the body of each function marked `BACKEND:` and set `DEMO_MODE: false`.

## Booking flow

```
Step 1  Route        getBookingConfig()      → service areas on the map
                     (customer enters pickup, stops, destination, date, time)
Step 2  Vehicle      getAvailableVehicles()  → free vehicles + prices
                     (customer picks a vehicle and fills in the form)
                     createBooking()         → booking saved as "pending_payment", vehicle reserved 15 min
Step 3  Payment      createPaymentOrder()    → PayPal / Apple Pay / card order
                     capturePayment()        → payment confirmed, booking "confirmed"
                     cancelPendingBooking()  → customer closed the window or the 15 min ran out
```

TOP-TRIP equivalents: `getBookingConfig` = `public-booking-config`, `createPaymentOrder` = `hyper-service`, `capturePayment` = `quick-task`.
In TOP-TRIP, vehicles and bookings were read and written directly from the browser (`carlist`, `bookinglist`). For Day Drive, we recommend doing this in backend functions, so that customers can't see other bookings or change prices.

---

## 1. `getBookingConfig()`

When: the page opens.

**Sends:** nothing (`{}`)

**Returns:**

| Field | Type | Example |
|---|---|---|
| `success` | boolean | `true` |
| `companies[]` | list of service areas | |
| `companies[].id` | text | `"frankfurt"` |
| `companies[].name` | text | `"Frankfurt am Main"` |
| `companies[].latitude` | number | `50.1109` |
| `companies[].longitude` | number | `8.6821` |
| `companies[].pickup_radius_km` | number | `60` |

The pickup must be inside one of these circles; otherwise "Book Now" stays disabled.

---

## 2. `getAvailableVehicles(trip)`

When: the vehicle window opens, and once more just before the booking is saved.

**Sends – the `trip` object:**

| Field | Type | Example | Notes |
|---|---|---|---|
| `pickup.address` | text | `"Frankfurt Airport (FRA), 60547 Frankfurt am Main, Germany"` | from Google |
| `pickup.lat` / `pickup.lng` | number | `50.0379` / `8.5622` | |
| `pickup.placeId` | text or null | `"ChIJ…"` | Google Place ID, null if the customer clicked the map |
| `destination.*` | | | same fields as pickup |
| `stops[]` | list | | 0–5 stops, in driving order |
| `stops[].address` / `lat` / `lng` / `placeId` | | | same as pickup |
| `stops[].waitMinutes` | number | `15` | 0–240 |
| `bookingDate` | text | `"2026-09-25"` | as entered |
| `bookingTime` | text | `"12:30"` | as entered (German time) |
| `bookingStart` | ISO date-time (UTC) | `"2026-09-25T10:30:00.000Z"` | pickup time |
| `bookingEnd` | ISO date-time (UTC) | `"2026-09-25T11:05:00.000Z"` | start + driving + waiting |
| `timezone` | text | `"Europe/Berlin"` | |
| `distanceKm` | number | `15.35` | whole route incl. stops |
| `drivingDurationMinutes` | number | `20` | driving only |
| `waitMinutes` | number | `15` | sum of all stop waits |
| `durationMinutes` | number | `35` | driving + waiting |
| `waitFee` | number | `3.75` | demo rule: €0.25 per waiting minute |
| `longTrip` | boolean | `false` | demo rule: over 80 km |
| `routeSource` | text | `"google"` | `"estimate"` if Google could not calculate the route |
| `serviceAreaId` | text | `"frankfurt"` | area the pickup is in |
| `language` | text | `"de"` / `"en"` | |

**Returns:**

| Field | Type | Example |
|---|---|---|
| `vehicles[]` | list, cheapest first | |
| `vehicles[].id` | text | `"e-class"` |
| `vehicles[].name` | text | `"Mercedes-Benz E-Class"` |
| `vehicles[].category` | text | `"VIP · Executive · Business"` |
| `vehicles[].seats` | number | `3` |
| `vehicles[].luggage` | number | `2` |
| `vehicles[].image_url` | text or null | `"https://…/e-class.webp"` |
| `vehicles[].price` | number | `55.00` – **final price for this trip** |
| `vehicles[].currency` | text | `"EUR"` |

The backend should:

- **Hide booked vehicles.** A vehicle is unavailable if another booking that isn't cancelled overlaps `bookingStart`–`bookingEnd`, plus 60 minutes before and after it (TOP-TRIP rule).
- **Calculate the price itself.** Use the vehicle's price per km and minimum fare, plus the waiting fee, the long-trip rule and any airport or night surcharge. Don't use a price sent by the browser.

---

## 3. `createBooking(booking)`

When: the customer clicks "Continue to payment".

**Sends – the `booking` object:**

| Field | Type | Example |
|---|---|---|
| `trip` | object | the complete `trip` from step 2 |
| `vehicle.id` | text | `"c-hr"` |
| `vehicle.name` | text | `"Toyota C-HR"` |
| `price.amount` | number | `41.75` – shown to the customer; **check it against your own calculation** |
| `price.currency` | text | `"EUR"` |
| `customer.firstName` | text | `"Max"` |
| `customer.lastName` | text | `"Mustermann"` |
| `customer.email` | text (lower case) | `"max@example.com"` |
| `customer.phone` | text | `"+49 170 1234567"` |
| `customer.flightNumber` | text or null | `"LH400"` |
| `customer.passengers` | number | `2` |
| `customer.luggage` | number | `1` |
| `customer.notes` | text or null | `"Child seat please"` |
| `serviceType` | text | one of `airport_transfer`, `vip_executive`, `business_travel`, `wedding_events`, `family_group`, `school_children`, `long_term_monthly`, `hourly`, `other` |
| `termsAccepted` | boolean | `true` |
| `language` | text | `"de"` – use it for the confirmation e-mail |
| `source` | text | `"website"` |

**Returns:**

| Field | Type | Example |
|---|---|---|
| `bookingId` | text (UUID) | `"3f2c…"` |
| `bookingReference` | text | `"DD-3F2C1A"` – shown to the customer |
| `amount` | number | `41.75` – amount to pay |
| `currency` | text | `"EUR"` |
| `paymentExpiresAt` | ISO date-time | now + 15 min – drives the countdown |

The backend should:

1. Check availability again.
2. Save the booking with status `pending_payment`.
3. Reserve the vehicle until `paymentExpiresAt`.

Suggested booking columns, following TOP-TRIP's `bookinglist`:

| Column | Filled from |
|---|---|
| customer | `first_name`, `last_name`, `email`, `phone`, `flight_number`, `passengers`, `luggage`, `notes` |
| route | `pickup_address`, `pickup_lat`, `pickup_lng`, `pickup_place_id`, the same four `destination_*` columns, `stop_points` (JSON), `distance_km` |
| times | `booking_date`, `booking_time`, `booking_start`, `booking_end`, `duration_minutes`, `driving_duration_minutes`, `wait_minutes` |
| vehicle | `car_id`, `car_name` |
| money | `price`, `wait_fee`, `currency` |
| other | `service_type`, `language`, `source` |
| status | `booking_status` (`pending_payment` → `confirmed` / `cancelled` / `expired`), `payment_status` (`pending` → `paid` / `failed`), `payment_provider`, `payment_reference`, `payment_expires_at`, `paid_at`, `created_at` |

---

## 4. `createPaymentOrder(payment)`

When: the customer clicks a payment button.

**Sends:**

| Field | Type | Example |
|---|---|---|
| `bookingId` | text | from step 3 |
| `amount` | text | `"41.75"` |
| `currency` | text | `"EUR"` |
| `paymentMethod` | text | `"paypal"`, `"applepay"` or `"card"` |
| `verificationMethod` | text or null | `"SCA_WHEN_REQUIRED"` for cards (3-D Secure) |

**Returns:** `{ orderId }`, the PayPal order ID. The backend should take the amount from the saved booking, not from the browser.

---

## 5. `capturePayment(payment)`

When: the customer has approved the payment (PayPal window, Apple Pay sheet or card form).

**Sends:** `{ bookingId, orderId }`

**Returns:** `{ status: "COMPLETED", paymentReference, paidAt }`

Then:

1. Set the booking to `confirmed` / `paid`.
2. Send the confirmation e-mail in `language`.
3. Redirect the customer to a success page. `booking-success.html` still needs to be built.

---

## 6. `cancelPendingBooking(info)`

When: the customer closes the payment window, or the 15-minute reservation runs out.

**Sends:** `{ bookingId, reason: "closed" | "expired" }`

**Returns:** `{ success: true }`. The backend should free the vehicle.

The backend should also expire unpaid bookings by itself when `payment_expires_at` has passed, in case the customer just closes the browser.

---

## Still to do before going live

- **Backend:** the 6 functions above, a vehicles table and a service-areas table.
- **Real vehicle data:** seats, luggage, price per km, minimum fare and photos. The demo values in `dd-booking-api.js` are made up.
- **Payment accounts:** your **own** PayPal account and Client ID. The TOP-TRIP Client ID must not be reused. Apple Pay also requires registering your domain with PayPal.
- **Payment buttons:** the real PayPal, Apple Pay and card buttons, which will replace the demo buttons in `dd-booking-checkout.js`. The code from `paypal-single-click.js`, `apple-pay.js` and `paypal-card.js` can be reused.
- **Google Maps key:** restrict it in Google Cloud Console → Credentials to your website addresses (e.g. `https://shahbaz-ahmadzai.github.io/*` and your own domain). The key is visible in the page source, so it must be restricted.
- **Pages:** `booking-success.html`, plus the terms (AGB) and privacy (Datenschutz) pages that the booking form refers to.
