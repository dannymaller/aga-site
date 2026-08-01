# Avondale Gardening Alliance, member features

Static build of the AGA homepage plus the new member sign-up flow. No build step, no dependencies. Cloudflare Pages serves these files as they are.

## Structure

```
index.html              homepage, rebuilt from the live site
membership.html         member sign-up form
_headers                cache and security headers for Cloudflare Pages
assets/
  base.css              tokens, type roles, header, buttons, footer
  home.css              hero, welcome, fair
  membership.css        form, tool tray, success state
  membership.js         validation, Mapbox autocomplete, submit
  american-typewriter.woff2
  logo.png  hero.png  flyer.jpg  torn.png
```

## Fonts

Four roles, all set as CSS variables at the top of `base.css`:

| Variable | Now | Should be |
| --- | --- | --- |
| `--font-display` | American Typewriter, embedded | same |
| `--font-marker` | Gochi Hand (Google) | Aga New Font 2025 |
| `--font-ui` | Permanent Marker (Google) | Aga New Font 2025 |
| `--font-body` | Avenir Next, falls back to Nunito Sans | Avenir Next webfont |

To swap in a real font file, drop the `.woff2` in `assets/`, add an `@font-face` next to the American Typewriter one, and change the variable. Nothing else needs touching.

## Two values to configure

Both live at the top of `assets/membership.js`:

- `APPS_SCRIPT_URL`, the `/exec` URL from the Google Apps Script web app deployment
- `MAPBOX_TOKEN`, your public `pk.` token

## Running it locally

```
python3 -m http.server 8000
```

Then http://localhost:8000. Opening the files straight off disk with `file://` will break the form submission and the font loading.

## Deploying

Cloudflare Pages, connected to this repo. Build command: leave empty. Build output directory: `/`. Every push to `main` publishes, every pull request gets its own preview URL.
