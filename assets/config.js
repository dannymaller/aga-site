/**
 * The only file with settings in it. Already filled in.
 *
 * APPS_SCRIPT_URL is the /exec address of the Google Apps Script web app that
 * reads and writes the members sheet. If you ever create a brand new
 * deployment rather than a new version of the existing one, Google issues a
 * new URL and it goes here.
 *
 * Nothing else needs configuring. The map draws with OpenStreetMap tiles and
 * addresses are looked up by the Census geocoder, so there are no API keys
 * anywhere in this project.
 */
window.AGA_CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwRDdKsHdD1g4XrqmaPzukwjtZBu2hjsHrE81Tlv6NckXk4RnmRZRlage-s7aYiKRfy/exec"
};
