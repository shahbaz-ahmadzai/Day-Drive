# Day Drive Service – Website

VIP chauffeur service in Frankfurt. Plain HTML, CSS and JavaScript – no build step needed.

## Open it

Double-click `index.html`, or run a small local server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## New: driver app, customer area, monthly rides

| Page | What it is |
|------|------------|
| `driver/` | Driver app for the phone home screen (German, English, Arabic, Pashto, Dari): start/end work, rides, ride code, chat, expenses with receipt photo, Uber/Bolt earnings at the end of the day |
| `account.html` | **My Day Drive** – customers log in with an SMS code: rides, not confirmed / not paid, history, monthly rides, balance statement |
| `ride.html` | Ride page from the SMS link: status, ride code, driver, car, chat with the driver |
| `monthly.html` | Request form for monthly rides (school / work) with prices |
| `sw.js`, `manifest.webmanifest` | Lets customers add My Day Drive to the home screen and get push messages |

How to give a driver access: Admin → Drivers → the driver → **Driver app** → "Give app access" (username + PIN). The driver opens `…/driver/` on the phone and adds it to the home screen.

## Pages

| File | What it is |
|------|------------|
| `index.html` | Main page: hero, Services, Why us, Fleet, Book-now banner, Contact (footer), plus the Services and Fleet pop-up windows |
| `about.html` | About Us |
| `prices.html` | Prices, with a pre-filled "Get a Quote" e-mail |
| `booking.html` | Online booking: map route with stops → vehicle + customer details → payment (demo mode until the backend is connected) |

## Menu behaviour

- Logo and **Home** → top of the main page
- **Services**, **Fleet**, **Contact** → scroll smoothly to that part of the main page (works from the other pages too)
- **About Us**, **Prices** → open their own page
- **Book a Ride / Book Now** → `booking.html`
- Service icons and service cards → **Services pop-up**, opened at the service that was clicked
- **View Fleet** → **Fleet pop-up**

## Languages (English / Deutsch)

All text lives in **`js/translations.js`**, in `en` and `de`.
In the HTML, an element shows a text by its key, e.g. `<h2 data-i18n="services.title"></h2>`.

- Change a text: edit it in `js/translations.js` (both languages).
- Add a text: add the same new key to `en` **and** `de`, then use it with `data-i18n="your.key"`.
- `data-i18n-html` allows simple HTML such as `<br>`; `data-i18n-attr="alt:key"` translates an attribute.
- The chosen language is remembered in the browser. The first visit uses the browser's language.

## Updating CSS or JavaScript (important)

Browsers keep saved copies of `css/style.css` and the `js/` files. So that visitors always get the newest version,
each page loads them with a version number, e.g. `css/style.css?v=202609252300`.

**Whenever you change `style.css` or any file in `js/`, change that number in all HTML files** (the 4 pages + `admin/index.html` + `admin/app.html`; any new number works, e.g. today's date and time).
In VS Code: *Find in Files* → search `?v=202609252300` → *Replace All* with a new number.

## Booking page files

| File | What it does |
|------|--------------|
| `css/dd-booking.css` | Styles for the booking page only |
| `js/dd-booking-api.js` | Settings (Supabase + Google Maps keys) and **all backend calls** (function `public-booking`) |
| `js/dd-booking-map.js` | Step 1: Google map, address search, stops, route, service area, date/time |
| `js/dd-booking-checkout.js` | Step 2: vehicle choice + customer form, then the confirmation window (or the payment window once PayPal is on) |
| `BOOKING-BACKEND.md` | Every value the page sends to / expects from the backend |

## Online booking is LIVE

Website bookings are saved in Supabase (project **Day-Drive**) and appear in the admin panel immediately.

- Payment mode **“Pay on the ride”**: the booking is confirmed at once, the customer pays the chauffeur (cash/card).
- The customer gets an **SMS confirmation** (Twilio), the office mobile gets a **“new booking” SMS** (Admin → Settings → Notifications).
- Prices, free vehicles and the service area are always checked **on the server** – nobody can change the price in the browser.
- When PayPal is connected: Admin → Settings → Booking rules → Payment → “Pay online”.

## Admin panel (`admin/`)

Open **`/admin/`** on the website (e.g. `https://…github.io/Day-Drive/admin/`) and sign in with your username.

| Menu | What it does |
|------|--------------|
| Dashboard | Today's rides, next 7 days, rides without a driver, expiring TÜV/insurance/licences, quick actions |
| Inbox | E-mails (empty until Resend + own domain are set up) |
| Bookings | All bookings, filters, search, CSV export, assign vehicle/driver, status, SMS, cancel, no-show, complete + record income, phone bookings |
| Vehicles | Fleet, website prices (per km, minimum fare, airport fee, night surcharge), photo, show/hide on website, TÜV/insurance/service dates, rides and costs per vehicle |
| Drivers | Staff data, licence / P-Schein / medical dates, private documents, vehicle assignment, rides |
| Finance | Month overview (income, costs, result, VAT), all entries, receipts, cancel entry (GoBD – no deleting), recurring costs, close month, CSV export for the tax advisor |
| Add expense | Quick form for fuel, parking, workshop … with receipt photo (works on the phone) |
| Profile | Own details and password |
| Settings | Company, booking rules + service areas, notifications, integrations (Twilio test SMS), team logins & roles, finance settings, activity log |

**Roles:** Owner (everything + team logins) · Admin (everything except logins) · Dispatcher (bookings, vehicles, drivers, add expenses) · Accountant (finance + expenses).

**Adding a page later:** create `admin/js/pages/<name>.js` (`export default { render(root, ctx) {…} }`) and add one line to `PAGES` in `admin/js/app.js`.
A settings section is one entry in `SECTIONS` in `admin/js/pages/settings.js`.

| Folder / file | Purpose |
|---------------|---------|
| `admin/index.html` | Sign-in page |
| `admin/app.html` | The panel (menu + pages) |
| `admin/css/admin.css` | Admin styles |
| `admin/js/config.js` | Supabase URL + publishable key, locale |
| `admin/js/core/` | Shared code: Supabase client, sign-in & roles, UI kit, formatting, lookups |
| `admin/js/pages/` | One file per menu item |

## Backend (Supabase project “Day-Drive”)

| Part | Details |
|------|---------|
| Tables | bookings, ride_contracts, customer_ledger, driver_shifts, vehicle_devices, vehicle_events, ride_messages, push_subscriptions, holidays, booking_events, customers, vehicles, drivers, driver_documents, vehicle_assignments, finance_* , company_profile, service_areas, app_settings, integrations, notifications, inbox_messages, payments, admin_users, audit_log |
| Security | Row Level Security on every table; the website has **no** direct table access. Finance entries can't be deleted or changed (GoBD) |
| Edge functions | `public-booking` (website), `booking-sms` (Twilio), `admin-login` (username → login), `admin-users` (team logins), `driver-auth`, `customer-auth`, `regular-rides`, `vehicle-device` (ESP32), `push-send` – source in `supabase/functions/` |
| Database history | `supabase/migrations/` (01–14, exactly as applied) |
| Secrets | Twilio, push (VAPID) and internal keys in Supabase Vault |
| Storage | `vehicle-images` (public), `driver-documents`, `receipts`, `admin-avatars` |

**Driver app, My Day Drive, monthly rides, deposit balance, ESP32 and push:** see [`BACKEND.md`](BACKEND.md).

## Shared header & footer

The menu bar and the footer are written once in **`js/layout.js`** and added to every page automatically.
Contact details (phone, e-mail, WhatsApp) and social links are there too – replace the `#` social links with your real profiles.

## Fleet slider

Each car is one `.fleet-slide` block in `index.html`. Copy the block to add another vehicle; a dot is added automatically.

## Images (`assets/images`)

| File | Used for |
|------|----------|
| `logo-light.svg` / `logo-light.png` | Logo on dark background (header, footer, favicon) |
| `logo-dark.svg` | Logo for light backgrounds |
| `hero.jpg` | Hero background (Frankfurt skyline + Mercedes) |
| `service-*.jpg` | The five service cards |
| `fleet-e-class.webp` / `.png` | Mercedes E-Class, transparent background |
| `cta-background.jpg` | "Book Your Ride Today" banner |

## Still to do

- PayPal (online payment) – needs Day Drive's PayPal business account
- Resend (e-mail confirmations + inbox) – needs the website's own domain
- Photos of the VW Touran, Toyota Proace City, Toyota Corolla and Toyota C-HR
- Imprint (Impressum), Privacy Policy (Datenschutz), Terms (AGB) – required for a German website; footer links are ready
- Real social-media links
- Screens for the driver app, My Day Drive, ride page and monthly rides (backend ready – see `BACKEND.md`)
