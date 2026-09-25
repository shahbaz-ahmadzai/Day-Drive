# Day Drive Service – Website

VIP chauffeur service in Frankfurt. Plain HTML, CSS and JavaScript – no build step needed.

## Open it

Double-click `index.html`, or run a small local server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

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
each page loads them with a version number, e.g. `css/style.css?v=202609251046`.

**Whenever you change `style.css` or any file in `js/`, change that number in all 4 HTML files** (any new number works, e.g. today's date and time).
In VS Code: *Find in Files* → search `?v=202609251046` → *Replace All* with a new number.

## Booking page files

| File | What it does |
|------|--------------|
| `css/dd-booking.css` | Styles for the booking page only |
| `js/dd-booking-api.js` | Settings (Google Maps key, demo mode, demo vehicles/prices/service area) and **all backend calls** |
| `js/dd-booking-map.js` | Step 1: Google map, address search, stops, route, service area, date/time |
| `js/dd-booking-checkout.js` | Steps 2 + 3: vehicle choice, customer form, payment window |
| `BOOKING-BACKEND.md` | Every value the page sends to / expects from the backend |

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

- Booking backend (see `BOOKING-BACKEND.md`) and `booking-success.html`
- Photos of the VW Touran, Toyota Proace City, Toyota Corolla and Toyota C-HR
- Imprint (Impressum), Privacy Policy (Datenschutz), Terms (AGB) – required for a German website; footer links are ready
- Real social-media links
