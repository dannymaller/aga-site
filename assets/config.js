/**
 * The only file with settings in it. Both the sign-up form and the map read
 * from here, so you paste each value once.
 *
 * APPS_SCRIPT_URL  the /exec URL from Deploy > Manage deployments
 * MAPBOX_TOKEN     your public token from account.mapbox.com, starts with pk.
 *
 * Both are visible to anyone who views source. That is normal for these two.
 * Add a URL restriction to the Mapbox token in your account once the real
 * domain is live, so it only works on your own site.
 */
window.AGA_CONFIG = {
  APPS_SCRIPT_URL: "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE",
  MAPBOX_TOKEN: "PASTE_YOUR_MAPBOX_TOKEN_HERE"
};
