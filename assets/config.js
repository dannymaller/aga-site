/**
 * The only settings file. All pages read from here.
 *
 * APPS_SCRIPT_URL  the /exec address of the Apps Script web app. Already set.
 *
 * BASEMAP          which map background to draw. Options:
 *                    "voyager"   clean and muted, free, no account   (default)
 *                    "positron"  near greyscale, lets pins pop, free
 *                    "osm"       standard OpenStreetMap, busiest of the three
 *                    "mapbox"    Mapbox, needs a token below
 *
 * MAPBOX_TOKEN     only needed if BASEMAP is "mapbox". Public token from
 *                  account.mapbox.com, starts with pk. Free tier covers tens
 *                  of thousands of map loads a month.
 * MAPBOX_STYLE     which Mapbox style, e.g. outdoors-v12, streets-v12,
 *                  light-v11, satellite-streets-v12
 */
window.AGA_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwRDdKsHdD1g4XrqmaPzukwjtZBu2hjsHrE81Tlv6NckXk4RnmRZRlage-s7aYiKRfy/exec",

  BASEMAP: "voyager",
  MAPBOX_TOKEN: "",
  MAPBOX_STYLE: "outdoors-v12"
};
