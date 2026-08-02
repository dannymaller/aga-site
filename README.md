# Avondale Gardening Alliance

Homepage, member sign-up, sign-in, member dashboard, and member map. Plain
HTML, CSS, and JavaScript. No build step, no dependencies to install, no API
keys anywhere.

Three pieces fit together:

1. These files, hosted on Cloudflare Pages
2. A Google Sheet that holds members
3. A Google Apps Script sitting between them, in `Code.gs`

## Files

```
index.html              homepage, rebuilt from the live site
membership.html         sign-up form, doubles as edit-your-details when signed in
login.html              sign in with an emailed code
dashboard.html          member home, signed in only
map.html                member map, signed in only
_headers                cache and security headers for Cloudflare Pages
README.md               this file
assets/
  config.js             the one settings file, already filled in
  auth.js               session storage and every call to the script
  base.css              tokens, type roles, header, buttons, footer
  home.css              hero, welcome, fair
  membership.css        form, tool tray, success state
  membership.js         validation, address check, submit, prefill
  account.css           login and dashboard
  login.js              two-step sign in
  dashboard.js          member home
  map.css               panel, filters, pins, popups
  map.js                fetches members, draws pins
  leaflet/              map library, self hosted
  american-typewriter.woff2
  logo.png hero.png flyer.jpg torn.png
```

`Code.gs` is not in this folder. It lives in the Apps Script editor attached to
your Google account.

## Setup, start to finish

### 1. The Apps Script

The sheet id is already written into `Code.gs`, so this is mostly clicking.

1. Open script.google.com and open the AGA project, or create one and paste in
   all of `Code.gs`
2. Save
3. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**
4. Run `backfill()` from the function dropdown to place any rows that have no
   coordinates yet

Saving alone never updates the live URL. Cutting a new version is what
publishes a code change. This trips everyone up once.

If the project is brand new, run `setup()` first. It authorizes the script,
builds both tabs, and writes one test row.

### 2. The site

Upload the contents of this folder to a GitHub repo, `index.html` at the top
level rather than nested inside a folder. Then in the Cloudflare dashboard:

**Workers & Pages → Create application → Pages → Connect to Git**, pick the
repo, and set:

- Framework preset: **None**
- Build command: **empty**
- Build output directory: **/**
- Production branch: **main**

Every push republishes. Every pull request gets its own preview URL.

### 3. Nothing else

No Mapbox account, no Google Maps key, no billing anywhere.

## How it works

### Sign-up

`membership.html` collects name, address, contact, what someone is here for,
and optionally a list of tools they will lend. It posts JSON to the Apps
Script, which appends to the **Members** tab and adds one row per tool to the
**Tools** tab. Signing up twice with the same email updates the existing row
instead of duplicating it.

### Addresses to coordinates

`Code.gs` does the lookup, not the browser. It asks the US Census Bureau
geocoder first: no key, and the data is public domain, so keeping coordinates
in the sheet carries no licensing strings. OpenStreetMap's Nominatim is the
fallback for addresses Census cannot match. The **Geocode Source** column
records which one answered, or `not found`.

While somebody fills the form, the page calls `?action=geocode` and shows what
was found, so a typo surfaces immediately. That check is advisory. The server
looks the address up again on submit regardless.

Mapbox geocoding is deliberately not used. Its terms permit displaying results
but not storing them, and storage requires a card on file.

### Signing in

No passwords. A member types their email, the script mails a six digit code,
and a correct code trades for a session token the browser keeps in
`localStorage` for 30 days. Come back inside that window and the login screen
never appears.

Codes and tokens are both stored hashed in the sheet, so a copy of the
spreadsheet does not let anyone in. Codes last ten minutes, burn after five
wrong tries, and can only be resent once a minute.

Two tabs appear on first use, **Auth** for pending codes and **Sessions** for
signed-in browsers. Both are safe to clear by hand at any time. Doing so signs
everyone out. `clearExpired()` sweeps out stale rows; put it on a daily trigger
if you like, or ignore it, since expired rows are refused anyway.

Mail goes out from the Google account that owns the script. Consumer Gmail
allows on the order of 100 messages a day, which is a lot of sign-ins for a
group this size.

Tuning knobs sit at the top of `Code.gs`: `CODE_MINUTES`, `SESSION_DAYS`,
`MAX_ATTEMPTS`, `RESEND_SECONDS`.

If somebody's email is not in the Members tab, the login page says so and
offers the sign-up form rather than pretending a code went out. That does tell
a stranger whether an address is a member, which for a public neighborhood
group is a fair trade for not stranding people on a screen that lies to them.

### The Membership tab

There is one Membership tab in the nav and it follows who you are.

- No session in the browser: it opens the login card, which offers Sign up now
  for anyone who is not a member yet
- Session found: it opens the dashboard, so members never see the login screen
- Session expired or the browser was cleared: back to the login card

The markup points the tab at `login.html`. `auth.js` repoints any link marked
`data-account-link` to `dashboard.html` when it finds a session. Adding the tab
to a new page means copying that one attribute.

`dashboard.html` shows the member their own record: name, address, contact,
what they picked, their tools, and whether their pin actually landed. From
there they can open the map or edit their details.

Editing reuses the sign-up form. When a signed-in member opens
`membership.html`, it fills itself in from their record and the button changes
to Save changes. Submitting updates their row instead of adding one, since the
script matches on email.

### The map

`map.js` calls `?action=members` with the session token. It answers only to a signed-in member, with public fields only:
display name, coordinates, interests, the free-text note, and tools. Email,
phone, and street address never leave the sheet. Rows without coordinates, or
without a Yes in the Consent column, are skipped.

Pin color says why someone is on the map. Green has a garden, blue needs space,
clay wants a hand, teal for anything else. A thick brown ring means they lend
tools.

Names show as first name plus last initial. Flip `SHOW_FULL_LAST_NAME` at the
top of `Code.gs` for full names.

Tiles come from OpenStreetMap and Leaflet is served from `assets/leaflet/`, so
the map has no third-party account behind it. OSM asks that heavy users run
their own tile server. A neighborhood map is nowhere near that line.

## Fonts

Four roles, set as CSS variables at the top of `base.css`:

| Variable | Now | Should be |
| --- | --- | --- |
| `--font-display` | American Typewriter, embedded | same |
| `--font-marker` | Gochi Hand (Google) | Aga New Font 2025 |
| `--font-ui` | Permanent Marker (Google) | Aga New Font 2025 |
| `--font-body` | Avenir Next, falls back to Nunito Sans | Avenir Next webfont |

To swap a real font in, drop the `.woff2` in `assets/`, add an `@font-face`
next to the American Typewriter one, and change the variable.

## Working on it locally

```
python3 -m http.server 8000
```

Then http://localhost:8000. Opening the files straight off disk with `file://`
breaks the form and the map, since the browser blocks those requests.

Add `?debug` to any page URL to see real error messages instead of the friendly
ones.

## Adding a member by hand

Type the row into the Members tab. The map only reads First Name, Last Name,
Lat, Lng, Interests, Tool Sharing, and Consent. Leave Lat and Lng empty and run
`backfill()`, which fills them in from the address columns.

## Known gaps

- The homepage hero is an image cropped from the live site. The original is an
  SVG and would be sharper.
- Pins sit at exact addresses. The map is behind a login now, so only members
  see them, but if that is still too precise the fix is fuzzing the
  coordinates in `publicMembers()` before they go out.
- No welcome email on sign-up. The plumbing is there, `MailApp.sendEmail` is
  already in use for codes.
- Nothing stops somebody signing up with an email that is not theirs. Requiring
  a code before the row is written would close that, at the cost of a longer
  sign-up.
- No admin view. Right now managing members means opening the sheet.
