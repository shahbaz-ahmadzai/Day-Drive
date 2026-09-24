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
| `index.html` | Main page: hero, Services, Why us, Fleet, Book-now banner, Contact (footer) |
| `about.html` | About Us – placeholder, to be built |
| `prices.html` | Prices – placeholder, to be built |
| `booking.html` | Booking page (all "Book a Ride" / "Book Now" buttons go here) – placeholder |

## Menu behaviour

- Logo and **Home** → top of the main page
- **Services**, **Fleet**, **Contact** → scroll smoothly to that part of the main page (works from the other pages too)
- **About Us**, **Prices** → open their own page
- **Book a Ride / Book Now / Get a Quote** → `booking.html`

## Languages (English / Deutsch)

All text lives in **`js/translations.js`**, in `en` and `de`.
In the HTML, an element shows a text by its key, e.g. `<h2 data-i18n="services.title"></h2>`.

- Change a text: edit it in `js/translations.js` (both languages).
- Add a text: add the same new key to `en` **and** `de`, then use it with `data-i18n="your.key"`.
- `data-i18n-html` allows simple HTML such as `<br>`; `data-i18n-attr="alt:key"` translates an attribute.
- The chosen language is remembered in the browser. The first visit uses the browser's language.

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

- About, Prices and Booking pages
- Imprint (Impressum), Privacy Policy (Datenschutz), Terms (AGB) – required for a German website; footer links are ready
- Real social-media links
