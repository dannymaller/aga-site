# Avondale Gardening Alliance

Homepage, member sign-up, and member map. Plain HTML, CSS, and JavaScript. No
build step, no dependencies to install, no API keys anywhere.

Three pieces fit together:

1. These files, hosted on Cloudflare Pages
2. A Google Sheet that holds members
3. A Google Apps Script sitting between them, in `Code.gs`

## Files

```
index.html              homepage, rebuilt from the live site
membership.html         member sign-up form
map.html                member map
_headers                cache and security headers for Cloudflare Pages
README.md               this file
assets/
  config.js             the one settings file, already filled in
  base.css              tokens, type roles, header, buttons, footer
  home.css              hero, welcome, fair
  membership.css        form, tool tray, success state
  membership.js         validation, address check, submit
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

### The map

`map.js` calls `?action=members`. The script answers with public fields only:
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
- Pins sit at exact addresses. If the map should not show where people live,
  the fix is either fuzzing coordinates in `Code.gs` before they go out, or
  putting the map behind a login.
- No confirmation email on sign-up. Apps Script can send one with
  `MailApp.sendEmail` in a few lines.
