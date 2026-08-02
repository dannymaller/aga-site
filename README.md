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
library.html            your tools, requests on them, active loans
loans.html              things you've borrowed and lent, reviews
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
  map.js                fetches members, draws pins, borrow modal
  library.js            the tool library
  loans.js              borrowing, lending, reviews
  library.css           library, loans, modals, disclaimer
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

Two ways in, no passwords either way.

**Sign in with Google** is one click for anyone whose Google account uses the
email they joined with. The browser gets an ID token from Google, the Apps
Script asks Google to vouch for it, checks it was issued for this site, and
only then looks the email up in Members.

A Google account that is not a member yet can join in the same pass. The form
opens with name and email already filled from Google, the email field locked
since Google vouched for it, and the credential held in `sessionStorage`. That
credential rides along with the sign-up itself, so the script writes the row
and hands back a session in the same reply. They land on the dashboard signed
in, having clicked Google exactly once.

### Telling what is actually deployed

Open the `/exec` URL in a browser. The health check reports the `VERSION`
constant from the top of `Code.gs` and which functions the running copy has:

```json
{"ok":true,"version":"2026-08-02-google-join",
 "has":{"googleSignIn":true,"geocode":true,"startSession":true,"backfill":true}}
```

If that version is behind what you pasted, the deployment is stale. Saving the
editor never changes what `/exec` serves. Deploy > Manage deployments > pencil
> New version > Deploy is the only thing that does. Bump `VERSION` whenever you
paste a new copy and this check stays honest.

Setting it up, once:

1. console.cloud.google.com, make a project
2. APIs & Services > OAuth consent screen. External, fill in the name and your
   support email, publish it. The scopes here are basic profile ones, so
   Google does not require a review.
3. APIs & Services > Credentials > Create credentials > OAuth client ID >
   Web application
4. Under Authorized JavaScript origins add every address the site answers on,
   for example `https://aga-site.pages.dev` and your custom domain. No paths,
   just the origin, and `http://localhost:8000` if you test locally.
5. Copy the client id into `GOOGLE_CLIENT_ID` in both `config.js` and `Code.gs`

Both must hold the same value. That match is what stops a token minted for
some other site being replayed here. Leave them empty and the Google button
never appears, leaving the emailed code on its own.

**An emailed code** is the fallback. A member types their email, the script
mails a six digit code,
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

Alongside it, the header swaps two buttons on the same signal. Signed out
shows Become a Member. Signed in shows Sign out. There is a second Sign out in
the footer of every page, so it is reachable without scrolling back up.

Both are marked in the markup, `data-join-cta` and `data-signout`, and
`auth.js` shows or hides them. Any number of `data-signout` buttons on a page
work; add the attribute anywhere and it gets wired up.

The markup points the tab at `login.html`. `auth.js` repoints any link marked
`data-account-link` to `dashboard.html` when it finds a session. Adding the tab
to a new page means copying that one attribute.

`dashboard.html` shows the member their own record in one profile card:
contact details, what they're up to, and their tools, since all three are
edited the same way. An Edit link sits in the card header and an Edit my
profile button at its foot, both opening the pre-filled sign-up form. The map
sits beside it in its own column so there is no dead space.

Editing reuses the sign-up form. When a signed-in member opens
`membership.html`, it fills itself in from their record and the button changes
to Save changes. Submitting updates their row instead of adding one, since the
script matches on email.

### The map

`map.js` calls `?action=members` with the session token. It answers only to a signed-in member, with public fields only:
display name, coordinates, interests, the free-text note, and tools. Email,
phone, and street address never leave the sheet. Rows without coordinates, or
without a Yes in the Consent column, are skipped.

Pins come in two colours only: green for gardening, amber brown for members
who lend tools, matching the brown that tools wear elsewhere. Both are set as
`--pin-garden` and `--pin-tools` in `base.css`, deliberately brighter than the
brand palette, since a dark green and a dark brown are the same colour at 22
pixels. A two item key sits under the panel button.

To colour only the members whose sole offering is tools, change the pin class
line in `render()` from `lends(m)` to `lends(m) && !m.interests.length`.

The panel is a fixed height with the filters and the member list scrolling
together inside it, and Add yourself to the map pinned below. That way the
tool chips can grow to however many categories exist without pushing anything
out of the box.

Filters come in two groups. **In the garden** has one chip per checkbox on the
sign-up form. **Tool sharing** is built from the categories members actually
listed, so it only shows Ladders if somebody lends a ladder, and the group
hides entirely when nobody lends anything.

Within a group, any selected chip counts. Across the two groups both have to
agree, so Has a garden plus Ladders finds gardeners who lend ladders rather
than everyone who does either. Everyone clears the lot.

Names show as first name plus last initial. Flip `SHOW_FULL_LAST_NAME` at the
top of `Code.gs` for full names.

### Changing how the map looks

Leaflet draws the map, and the background is a tile layer you can swap by
changing `BASEMAP` in `config.js`:

| Value | Look | Account needed |
| --- | --- | --- |
| `voyager` | clean and muted, the default | none |
| `positron` | near greyscale, pins pop hardest | none |
| `osm` | standard OpenStreetMap, busiest | none |
| `mapbox` | whatever Mapbox style you name | public token |

For Mapbox, set `BASEMAP: "mapbox"`, paste a public `pk.` token into
`MAPBOX_TOKEN`, and name a style in `MAPBOX_STYLE`, such as `outdoors-v12`,
`streets-v12`, `light-v11`, or `satellite-streets-v12`. Mapbox tiles are drawn
through Leaflet, so nothing else changes. If `BASEMAP` says mapbox and the
token is missing, it quietly falls back to voyager rather than showing a blank
map.

Note this is only about the map background. Addresses are still turned into
coordinates by the Census geocoder, which has no such terms attached.

## The tool library

Members lend tools to each other for free. The Alliance only runs the board.

Three tabs hold it, created automatically the first time each is written:

- **Tools** now carries a Tool ID and a Status per row. Every tool has a
  permanent ID so loans and reviews can point at it. Status is available, on
  loan, or paused.
- **Loans** is one row per borrow request, from asked through returned.
- **Reviews** is one row per person per loan.

The flow is borrower-driven. On the map, a member opens someone's pin, sees
their tools, and clicks Ask to borrow. That opens a short form with a proposed
return date, an optional note, and a liability checkbox they must tick. The
owner gets an email and finds the request in their library, where they approve
or decline. Approving flips the tool to on loan, emails the borrower, and
reveals the borrower's address to the owner for pickup. The owner marks it
returned when it's back. Every step emails the other person.

Once a tool is back, both people have seven days to leave the other a one to
five star review with a comment. Reviews are visible to all members and the
average shows on the tool. The window and the reciprocity are enforced in the
script, not just the page.

**The liability disclaimer** is plain-language and gates every borrow request
behind a checkbox: AGA is not responsible for lost, damaged, or stolen tools,
for injuries, or for disputes between members. It is not legal advice. Have a
lawyer read it before you lean on it. The wording lives in `map.js`, in the
borrow modal.

Editing tools happens in the library, not the sign-up form. The form now only
adds tools it hasn't seen for that member, and never deletes, so tool IDs and
their loan history survive a profile edit.

### After deploying this version

Run **migrateTools()** once from the editor. It stamps a Tool ID and a status
onto any tool row created before the library existed. Without it, older tools
can't be borrowed because nothing can point at them.

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

## Caching, and why a fix can look like it did not deploy

Asset URLs carry a version, `assets/membership.js?v=20260802a`. **When you
change a CSS or JS file, bump that string in every HTML file that loads it.**
Otherwise browsers holding a cached copy keep running the old one and your fix
appears not to have deployed.

`_headers` now asks browsers to revalidate markup and code on every request,
which makes stale copies far less likely. Revalidation costs nothing when the
file has not changed, the server answers 304 with no body. Images, the font,
and Leaflet still cache for a week, since those only change by being replaced.

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
