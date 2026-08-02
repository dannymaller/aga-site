/**
 * Avondale Gardening Alliance - membership intake
 *
 * SHEET_ID is already filled in below.
 *
 * AFTER PASTING THIS IN:
 * 1. Save.
 * 2. Run authorize() from the editor and approve the permissions. Sign-in
 *    emails will not send until you do, because a deployed web app cannot
 *    ask you for permission on its own.
 * 3. Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
 * 4. Run backfill() to place any rows that have no coordinates yet.
 *
 * AFTER ANY CODE CHANGE: Deploy > Manage deployments > pencil icon >
 * Version: New version > Deploy. Saving alone does not update the live URL.
 */

// Bump this whenever you paste a new copy in. Open the /exec URL in a browser
// and the version shows, which tells you whether the deployment is current.
var VERSION = '2026-08-03-tool-library';

// AGA members sheet.
var SHEET_ID = '1Mnvu5BRsHmhhwGbkpeJYgVLaB22vr_rZZIMKWlKo2gY';

// The map shows first name plus last initial. Flip to true for full names.
var SHOW_FULL_LAST_NAME = false;

// Sign in with Google. Paste the OAuth client id from Google Cloud Console
// here and into GOOGLE_CLIENT_ID in assets/config.js. They must match, that
// is what stops a token minted for some other site being used here.
// Leave both empty and the Google button simply does not appear.
var GOOGLE_CLIENT_ID = '209288712077-pmk0uhagpn0ti312j75r5l3m81qq12kt.apps.googleusercontent.com';

var MEMBER_HEADERS = [
  'Timestamp', 'First Name', 'Last Name', 'Email', 'Phone',
  'Street', 'Unit', 'City', 'State', 'ZIP', 'Lat', 'Lng',
  'Interests', 'About', 'Tool Sharing', 'Tool Count', 'Tool Notes', 'Consent',
  'Geocode Source'
];

var TOOL_HEADERS = ['Tool ID', 'Timestamp', 'Email', 'Member', 'Tool', 'Category', 'Notes', 'Status'];
// Status: 'available' | 'on loan' | 'paused'

// A borrow request and its whole life: pending -> approved (on loan) -> returned,
// or pending -> declined. Owner approves, owner marks returned.
var LOAN_HEADERS = [
  'Loan ID', 'Tool ID', 'Tool Name',
  'Owner Email', 'Owner Name',
  'Borrower Email', 'Borrower Name', 'Borrower Address',
  'Status', 'Message',
  'Requested', 'Decided', 'Due', 'Returned'
];
// Status: 'pending' | 'approved' | 'declined' | 'returned' | 'cancelled'

// One review per person per loan. Both sides may leave one, for 7 days after return.
var REVIEW_HEADERS = [
  'Review ID', 'Loan ID', 'Tool ID',
  'Reviewer Email', 'Reviewer Name',
  'Subject Email', 'Direction',
  'Rating', 'Comment', 'Created'
];
// Direction: 'of_borrower' (owner reviewing borrower) | 'of_owner' (borrower reviewing owner)

var REVIEW_WINDOW_DAYS = 7;

// Sign-in codes. Codes are stored hashed, never in the clear.
var AUTH_HEADERS = ['Email', 'Code Hash', 'Expires', 'Attempts', 'Sent At'];

// Logged-in browsers. Tokens are stored hashed too.
var SESSION_HEADERS = ['Token Hash', 'Email', 'Created', 'Expires'];

var CODE_MINUTES = 10;      // how long an emailed code is good for
var SESSION_DAYS = 30;      // how long a browser stays signed in
var MAX_ATTEMPTS = 5;       // wrong codes before the code is burned
var RESEND_SECONDS = 60;    // throttle on asking for another code

function doPost(e) {
  var d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: 'Could not read that request.' });
  }

  // Reads do not touch the lock. Making them wait behind a write was costing
  // seconds on every page load for no reason.
  switch (d.action) {
    case 'me':          return me(d);
    case 'members':     return memberList(d);
    case 'myLibrary':   return myLibrary(d);
    case 'toolDetail':  return toolDetail(d);
    case 'myLoans':     return myLoans(d);
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    switch (d.action) {
      case 'requestCode':  return requestCode(d);
      case 'verifyCode':   return verifyCode(d);
      case 'googleSignIn': return googleSignIn(d);
      case 'signOut':      return signOut(d);
      case 'saveTool':     return saveTool(d);
      case 'deleteTool':   return deleteTool(d);
      case 'setToolStatus':return setToolStatus(d);
      case 'requestLoan':  return requestLoan(d);
      case 'decideLoan':   return decideLoan(d);
      case 'markReturned': return markReturned(d);
      case 'cancelLoan':   return cancelLoan(d);
      case 'leaveReview':  return leaveReview(d);
    }

    if (!d.email || !d.first || !d.last) {
      return json({ ok: false, error: 'Missing name or email' });
    }

    var ss = book();
    var members = tab(ss, 'Members', MEMBER_HEADERS);
    var tools = tab(ss, 'Tools', TOOL_HEADERS);
    var now = new Date();
    var name = d.first + ' ' + d.last;
    var toolList = d.tools || [];

    // Coordinates come from the address, looked up here rather than in the browser
    var source = d.lat && d.lng ? 'browser' : '';
    if (!source) {
      var hit = geocode(addressOf(d));
      if (hit) {
        d.lat = hit.lat;
        d.lng = hit.lng;
        source = hit.source;
      } else {
        source = 'not found';
      }
    }

    var row = [
      now, d.first, d.last, d.email, d.phone || '',
      d.street || '', d.unit || '', d.city || '', d.state || '', d.zip || '',
      d.lat || '', d.lng || '',
      (d.interests || []).join('; '),
      d.about || '',
      '',  // Tool Sharing, set by syncToolCount below
      '',  // Tool Count, ditto
      d.toolNotes || '',
      d.consent ? 'Yes' : 'No',
      source
    ];

    // If this email already signed up, update that row instead of adding a duplicate.
    var existing = findRowByEmail(members, d.email);
    if (existing) {
      members.getRange(existing, 1, 1, row.length).setValues([row]);
    } else {
      members.appendRow(row);
    }

    // Tools are managed in the library now, each with a stable ID that loans and
    // reviews hang off. So the sign-up form only ADDS tools the member typed
    // that are not already there, and never touches or deletes existing ones.
    var existingTools = rowsOf(tools, TOOL_HEADERS).filter(function (x) {
      return String(x['Email']).toLowerCase().trim() === String(d.email).toLowerCase().trim();
    });
    var known = {};
    existingTools.forEach(function (x) { known[String(x['Tool']).toLowerCase().trim()] = true; });

    toolList.forEach(function (tl) {
      var key = String(tl.tool || '').toLowerCase().trim();
      if (!key || known[key]) return;
      known[key] = true;
      tools.appendRow([ newId('tool'), now, d.email, name, tl.tool, tl.category || '', tl.notes || '', 'available' ]);
    });

    syncToolCount(String(d.email).toLowerCase().trim());

    // Joined through Google? They already proved this address is theirs, so
    // hand back a session with the same reply rather than making them sign in.
    if (d.googleCredential) {
      var claims = verifyGoogleToken(d.googleCredential);
      if (claims && String(claims.email || '').toLowerCase().trim() === String(d.email).toLowerCase().trim()) {
        return startSession(String(d.email).toLowerCase().trim());
      }
    }

    return json({ ok: true, version: VERSION, updated: !!existing });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * GET with no parameters is a health check.
 * GET ?action=members feeds the map.
 *
 * Only fields meant to be public go out: display name, coordinates, what
 * they're into, and their tools. Email, phone, and street address never
 * leave the sheet.
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  // The sign-up form calls this while somebody is typing their address
  if (action === 'geocode') {
    var hit = geocode((e.parameter.q || '').trim());
    return hit
      ? json({ ok: true, found: true, lat: hit.lat, lng: hit.lng, matched: hit.matched })
      : json({ ok: true, found: false });
  }

  return json({
    ok: true,
    service: 'AGA membership intake',
    version: VERSION,
    has: {
      googleSignIn: typeof googleSignIn === 'function',
      geocode: typeof geocode === 'function',
      startSession: typeof startSession === 'function',
      backfill: typeof backfill === 'function'
    },
    googleConfigured: !!GOOGLE_CLIENT_ID
  });
}


/* =====================================================================
   Signing in
   ---------------------------------------------------------------------
   No passwords anywhere. Somebody types their email, we mail them a six
   digit code, and a correct code trades for a session token their browser
   holds onto. Codes and tokens are both stored hashed, so a copy of this
   spreadsheet does not let anyone in.
   ===================================================================== */

/** Step one: mail a code to a member. */
function requestCode(d) {
  var email = String(d.email || '').toLowerCase().trim();
  if (!email || email.indexOf('@') < 0) {
    return json({ ok: false, error: 'That does not look like an email address.' });
  }

  var row = findRowByEmail(book().getSheetByName('Members') || tab(book(), 'Members', MEMBER_HEADERS), email);
  if (!row) {
    // Not a member yet. The page offers the sign-up form instead.
    return json({ ok: true, member: false });
  }

  var auth = tab(book(), 'Auth', AUTH_HEADERS);
  var existing = findAuthRow(auth, email);
  var now = new Date();

  if (existing) {
    var sentAt = auth.getRange(existing, 5).getValue();
    if (sentAt && (now - new Date(sentAt)) / 1000 < RESEND_SECONDS) {
      return json({ ok: true, member: true, throttled: true });
    }
  }

  var code = String(Math.floor(100000 + Math.random() * 900000));
  var record = [email, sha(code + email), new Date(now.getTime() + CODE_MINUTES * 60000), 0, now];

  if (existing) {
    auth.getRange(existing, 1, 1, AUTH_HEADERS.length).setValues([record]);
  } else {
    auth.appendRow(record);
  }

  var first = String(book().getSheetByName('Members').getRange(row, 2).getValue() || '').trim();
  MailApp.sendEmail({
    to: email,
    subject: code + ' is your AGA sign-in code',
    body: [
      (first ? 'Hi ' + first + ',' : 'Hi,'),
      '',
      'Your sign-in code is ' + code,
      '',
      'It works for the next ' + CODE_MINUTES + ' minutes. If you did not ask to sign in,',
      'you can ignore this and nothing happens.',
      '',
      'Avondale Gardening Alliance'
    ].join('\n')
  });

  return json({ ok: true, member: true });
}

/** Step two: check the code, hand back a session token. */
function verifyCode(d) {
  var email = String(d.email || '').toLowerCase().trim();
  var code = String(d.code || '').replace(/\D/g, '');
  if (!email || code.length !== 6) {
    return json({ ok: false, error: 'Enter the six digit code from your email.' });
  }

  var auth = tab(book(), 'Auth', AUTH_HEADERS);
  var row = findAuthRow(auth, email);
  if (!row) return json({ ok: false, error: 'That code has expired. Ask for a new one.' });

  var vals = auth.getRange(row, 1, 1, AUTH_HEADERS.length).getValues()[0];
  var expires = new Date(vals[2]);
  var attempts = Number(vals[3]) || 0;

  if (new Date() > expires) {
    auth.deleteRow(row);
    return json({ ok: false, error: 'That code has expired. Ask for a new one.' });
  }
  if (attempts >= MAX_ATTEMPTS) {
    auth.deleteRow(row);
    return json({ ok: false, error: 'Too many tries. Ask for a new code.' });
  }
  if (sha(code + email) !== vals[1]) {
    auth.getRange(row, 4).setValue(attempts + 1);
    return json({ ok: false, error: 'That code did not match. ' + (MAX_ATTEMPTS - attempts - 1) + ' tries left.' });
  }

  auth.deleteRow(row);
  return startSession(email);
}

/**
 * Sign in with Google.
 *
 * The browser hands us the ID token Google issued. We ask Google to vouch for
 * it rather than trusting it, check it was minted for this site, and then only
 * sign the person in if that email is already a member.
 */
function googleSignIn(d) {
  if (!d.credential) return json({ ok: false, error: 'No sign-in came through from Google.' });

  var claims = verifyGoogleToken(d.credential);
  if (!claims) {
    return json({ ok: false, error: 'Google could not vouch for that sign-in. Try again.' });
  }

  var email = String(claims.email || '').toLowerCase().trim();
  if (!email) return json({ ok: false, error: 'Google did not share an email address.' });

  if (!findRowByEmail(tab(book(), 'Members', MEMBER_HEADERS), email)) {
    // Not a member yet. Hand back what Google told us so the sign-up form can
    // fill itself in, rather than making them type it all again.
    return json({
      ok: true,
      member: false,
      version: VERSION,
      email: email,
      first: claims.given_name || '',
      last: claims.family_name || ''
    });
  }

  return startSession(email);
}

/**
 * Asks Google to vouch for an ID token and checks it was minted for this site.
 * Returns the claims, or null if anything about it is off.
 */
function verifyGoogleToken(credential) {
  if (!credential) return null;
  try {
    var res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return null;

    var claims = JSON.parse(res.getContentText());
    if (GOOGLE_CLIENT_ID && claims.aud !== GOOGLE_CLIENT_ID) return null;
    if (String(claims.email_verified) !== 'true') return null;
    if (Number(claims.exp) * 1000 < Date.now()) return null;
    return claims;
  } catch (err) {
    Logger.log('Google token check failed: ' + err);
    return null;
  }
}

/** Mints a session token and hands it back with the member's own record. */
function startSession(email) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var now = new Date();
  var expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400000);
  tab(book(), 'Sessions', SESSION_HEADERS).appendRow([sha(token), email, now, expiresAt]);

  return json({
    ok: true,
    member: true,
    token: token,
    expires: expiresAt.toISOString(),
    profile: profileOf(email)
  });
}

/** The signed-in member's own record, address and all. */
function me(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });
  return json({ ok: true, profile: profileOf(email) });
}

/** The map. Members only. */
function memberList(d) {
  if (!sessionEmail(d.token)) return json({ ok: false, error: 'signed out' });
  return json({ ok: true, members: publicMembers() });
}

function signOut(d) {
  if (!d.token) return json({ ok: true });
  var sheet = book().getSheetByName('Sessions');
  if (!sheet || sheet.getLastRow() < 2) return json({ ok: true });
  var hash = sha(d.token);
  var col = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = col.length - 1; i >= 0; i--) {
    if (col[i][0] === hash) sheet.deleteRow(i + 2);
  }
  return json({ ok: true });
}

/**
 * Run this from the editor whenever the script gains a new power.
 *
 * A deployed web app cannot ask you for permissions, so anything the code
 * newly touches has to be approved here first. This exercises all four
 * things the project needs, so one approval covers the lot.
 *
 * Check the log afterwards. Every line should say ok.
 */
function authorize() {
  var report = [];

  // 1. the spreadsheet
  try {
    report.push('sheet: ok, ' + book().getName());
  } catch (err) {
    report.push('sheet: FAILED, ' + err);
  }

  // 2. your identity
  var me = '';
  try {
    me = Session.getEffectiveUser().getEmail();
    report.push('identity: ok, ' + me);
  } catch (err) {
    report.push('identity: FAILED, ' + err);
  }

  // 3. outbound web requests, used by Google sign-in and the geocoder
  try {
    var probe = UrlFetchApp.fetch(
      'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
      '?address=' + encodeURIComponent('2900 N Milwaukee Ave, Chicago, IL 60618') +
      '&benchmark=Public_AR_Current&format=json',
      { muteHttpExceptions: true }
    );
    report.push('web requests: ok, census replied ' + probe.getResponseCode());
  } catch (err) {
    report.push('web requests: FAILED, ' + err);
  }

  // 4. sending mail, used for sign-in codes
  try {
    MailApp.sendEmail({
      to: me,
      subject: 'AGA sign-in is authorized',
      body: 'If this landed in your inbox, the script can send sign-in codes.\n\n' +
            'Next: Deploy > Manage deployments > pencil icon > Version: New version > Deploy.'
    });
    report.push('mail: ok, sent to ' + me + ', ' + MailApp.getRemainingDailyQuota() + ' left today');
  } catch (err) {
    report.push('mail: FAILED, ' + err);
  }

  var out = report.join('\n');
  Logger.log(out);
  return out;
}

/* ---------- auth helpers ---------- */

function sha(s) {
  return Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
  );
}

function findAuthRow(sheet, email) {
  if (sheet.getLastRow() < 2) return null;
  var col = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).toLowerCase().trim() === email) return i + 2;
  }
  return null;
}

/** Returns the email behind a session token, or null if it is no good. */
function sessionEmail(token) {
  if (!token) return null;
  var sheet = book().getSheetByName('Sessions');
  if (!sheet || sheet.getLastRow() < 2) return null;

  var hash = sha(token);
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SESSION_HEADERS.length).getValues();
  var now = new Date();

  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] !== hash) continue;
    if (now > new Date(rows[i][3])) {
      sheet.deleteRow(i + 2);
      return null;
    }
    return String(rows[i][1]).toLowerCase().trim();
  }
  return null;
}

/** Everything about one member, for their own dashboard. */
function profileOf(email) {
  var sheet = book().getSheetByName('Members');
  var row = findRowByEmail(sheet, email);
  if (!row) return null;

  var r = sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0];
  var lends = String(r[14]).toLowerCase() === 'yes' && Number(r[15]) > 0;

  return {
    first: r[1], last: r[2], email: r[3], phone: r[4],
    street: r[5], unit: r[6], city: r[7], state: r[8], zip: r[9],
    lat: r[10], lng: r[11],
    interests: String(r[12] || '').split(';').map(function (s) { return s.trim(); }).filter(String),
    about: r[13],
    toolSharing: String(r[14]).toLowerCase() === 'yes',
    toolNotes: r[16],
    onMap: !!(r[10] && r[11]) && String(r[17]).toLowerCase() === 'yes',
    joined: r[0],
    tools: lends ? (groupTools()[String(email).toLowerCase().trim()] || []) : []
  };
}

/** Housekeeping. Set a daily trigger on this if you like. */
function clearExpired() {
  var now = new Date();
  [['Sessions', 4], ['Auth', 3]].forEach(function (pair) {
    var sheet = book().getSheetByName(pair[0]);
    if (!sheet || sheet.getLastRow() < 2) return;
    var col = sheet.getRange(2, pair[1], sheet.getLastRow() - 1, 1).getValues();
    for (var i = col.length - 1; i >= 0; i--) {
      if (col[i][0] && now > new Date(col[i][0])) sheet.deleteRow(i + 2);
    }
  });
}

/**
 * Address to coordinates.
 *
 * The US Census Bureau geocoder is first: no key, no rate deal, and the data
 * is public domain, so storing the result in the sheet carries no strings.
 * OpenStreetMap's Nominatim picks up the addresses Census misses.
 * Returns null when neither finds anything.
 */
function geocode(address) {
  if (!address) return null;

  try {
    var url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
      '?address=' + encodeURIComponent(address) +
      '&benchmark=Public_AR_Current&format=json';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      var matches = JSON.parse(res.getContentText()).result.addressMatches;
      if (matches && matches.length) {
        return {
          lat: matches[0].coordinates.y,
          lng: matches[0].coordinates.x,
          matched: matches[0].matchedAddress,
          source: 'census'
        };
      }
    }
  } catch (err) {
    Logger.log('Census lookup failed: ' + err);
  }

  try {
    Utilities.sleep(1100); // Nominatim asks for no more than one request a second
    var nurl = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(address);
    var nres = UrlFetchApp.fetch(nurl, {
      muteHttpExceptions: true,
      headers: { 'User-Agent': 'AvondaleGardeningAlliance/1.0 (avondalegardeners@gmail.com)' }
    });
    if (nres.getResponseCode() === 200) {
      var hits = JSON.parse(nres.getContentText());
      if (hits && hits.length) {
        return {
          lat: parseFloat(hits[0].lat),
          lng: parseFloat(hits[0].lon),
          matched: hits[0].display_name,
          source: 'osm'
        };
      }
    }
  } catch (err2) {
    Logger.log('Nominatim lookup failed: ' + err2);
  }

  return null;
}

function addressOf(d) {
  return [d.street, d.city, d.state, d.zip].filter(String).join(', ');
}

/**
 * Fills in coordinates for rows that do not have any yet. Run it from the
 * editor after adding members by hand, or after a lookup failed.
 */
function backfill() {
  var sheet = book().getSheetByName('Members');
  var last = sheet.getLastRow();
  if (last < 2) return 'Nothing to do.';

  var rows = sheet.getRange(2, 1, last - 1, MEMBER_HEADERS.length).getValues();
  var fixed = 0;

  for (var i = 0; i < rows.length; i++) {
    if (rows[i][10] && rows[i][11]) continue;
    var hit = geocode([rows[i][5], rows[i][7], rows[i][8], rows[i][9]].filter(String).join(', '));
    if (!hit) continue;
    sheet.getRange(i + 2, 11).setValue(hit.lat);
    sheet.getRange(i + 2, 12).setValue(hit.lng);
    sheet.getRange(i + 2, 19).setValue(hit.source);
    fixed++;
    Utilities.sleep(300);
  }
  Logger.log(fixed + ' row(s) placed on the map.');
  return fixed + ' row(s) placed on the map.';
}

/** The map payload. Public fields only: no email, phone, or street address. */
function publicMembers() {
  var sheet = book().getSheetByName('Members');
  if (!sheet || sheet.getLastRow() < 2) return [];

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, MEMBER_HEADERS.length).getValues();
  var toolsByEmail = groupTools();
  var out = [];

  rows.forEach(function (r) {
    var lat = parseFloat(r[10]);
    var lng = parseFloat(r[11]);
    if (!lat || !lng) return;                            // no coordinates, no pin
    if (String(r[17]).toLowerCase() !== 'yes') return;   // never listed without consent

    var last = String(r[2] || '').trim();
    var email = String(r[3] || '').toLowerCase().trim();

    out.push({
      id: Utilities.base64EncodeWebSafe(email).replace(/=+$/, ''),
      name: String(r[1] || '').trim() + (last ? ' ' + (SHOW_FULL_LAST_NAME ? last : last.charAt(0) + '.') : ''),
      lat: lat,
      lng: lng,
      interests: String(r[12] || '').split(';').map(function (s) { return s.trim(); }).filter(String),
      about: String(r[13] || '').trim(),
      toolSharing: String(r[14]).toLowerCase() === 'yes',
      toolNotes: String(r[16] || '').trim(),
      tools: toolsByEmail[email] || []
    });
  });

  return out;
}

function groupTools() {
  var sheet = book().getSheetByName('Tools');
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  rowsOf(sheet, TOOL_HEADERS).forEach(function (r) {
    var email = String(r['Email'] || '').toLowerCase().trim();
    var name = String(r['Tool'] || '').trim();
    if (!email || !name) return;
    if (String(r['Status']) === 'paused') return;   // hidden tools stay off the map/profile
    if (!map[email]) map[email] = [];
    map[email].push({
      id: r['Tool ID'] || '',
      tool: name,
      category: String(r['Category'] || '').trim(),
      notes: String(r['Notes'] || '').trim(),
      status: String(r['Status'] || 'available')
    });
  });
  return map;
}

/* ---------- helpers ---------- */

/**
 * Opens the spreadsheet. Uses SHEET_ID when set, otherwise falls back to the
 * sheet this script is bound to. Throws a readable error if neither works.
 */
var BOOK_ = null;   // opened once per request, not once per call

function book() {
  if (BOOK_) return BOOK_;
  if (SHEET_ID) {
    BOOK_ = SpreadsheetApp.openById(SHEET_ID);
    return BOOK_;
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    BOOK_ = active;
    return BOOK_;
  }
  throw new Error('No spreadsheet. Set SHEET_ID at the top of the script.');
}

/**
 * Run this once from the editor to authorize the script, build both tabs, and
 * drop a test row in. If this works, the sheet side of things is fine and any
 * remaining problem is in the browser or the deployment.
 */
function setup() {
  var ss = book();
  tab(ss, 'Members', MEMBER_HEADERS);
  tab(ss, 'Tools', TOOL_HEADERS);
  var fake = {
    postData: {
      contents: JSON.stringify({
        first: 'Test', last: 'Row', email: 'test@example.com',
        street: '2900 N Milwaukee Ave', city: 'Chicago', state: 'IL', zip: '60618',
        interests: ['I have a garden'], toolSharing: true,
        tools: [{ tool: 'Wheelbarrow', category: 'Carts and hauling', notes: '' }],
        consent: true
      })
    }
  };
  var out = doPost(fake).getContent();
  Logger.log('Wrote to: ' + ss.getName() + ' | ' + ss.getUrl());
  Logger.log('Result: ' + out);
  return out;
}

function tab(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRowByEmail(sheet, email) {
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var col = sheet.getRange(2, 4, last - 1, 1).getValues(); // column D, Email
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]).toLowerCase().trim() === email.toLowerCase().trim()) {
      return i + 2;
    }
  }
  return null;
}

function clearToolsFor(sheet, email) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var col = sheet.getRange(2, 2, last - 1, 1).getValues(); // column B, Email
  for (var i = col.length - 1; i >= 0; i--) {
    if (String(col[i][0]).toLowerCase().trim() === email.toLowerCase().trim()) {
      sheet.deleteRow(i + 2);
    }
  }
}

/**
 * One-time upgrade for tool rows created before the library existed. Adds a
 * Tool ID and a Status to any row missing them. Safe to run more than once.
 */
function migrateTools() {
  var sheet = tab(book(), 'Tools', TOOL_HEADERS);
  if (sheet.getLastRow() < 2) return 'No tools to migrate.';

  var rows = rowsOf(sheet, TOOL_HEADERS);
  var fixed = 0;
  rows.forEach(function (r) {
    var needsId = !r['Tool ID'];
    var needsStatus = !r['Status'];
    if (!needsId && !needsStatus) return;
    if (needsId) sheet.getRange(r._row, 1).setValue(newId('tool'));
    if (needsStatus) sheet.getRange(r._row, 8).setValue('available');
    fixed++;
  });
  Logger.log(fixed + ' tool row(s) upgraded.');
  return fixed + ' tool row(s) upgraded.';
}

/**
 * Deletes rows in Tools whose email is not in Members. Those pile up when a
 * member row is deleted by hand and the tools are left behind. Run it from the
 * editor whenever the tool counts look wrong.
 */
function pruneOrphanTools() {
  var members = book().getSheetByName('Members');
  var tools = book().getSheetByName('Tools');
  if (!tools || tools.getLastRow() < 2) return 'No tools to check.';

  var live = {};
  if (members && members.getLastRow() > 1) {
    members.getRange(2, 4, members.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var e = String(r[0]).toLowerCase().trim();
      if (e) live[e] = true;
    });
  }

  var emails = tools.getRange(2, 3, tools.getLastRow() - 1, 1).getValues();  // Email is column 3 now
  var removed = 0;
  for (var i = emails.length - 1; i >= 0; i--) {
    var e = String(emails[i][0]).toLowerCase().trim();
    if (!live[e]) {
      tools.deleteRow(i + 2);
      removed++;
    }
  }
  Logger.log(removed + ' orphaned tool row(s) removed.');
  return removed + ' orphaned tool row(s) removed.';
}


/* =====================================================================
   Tool library, borrowing, and reviews
   ===================================================================== */

var SITE_URL = 'https://aga-site.pages.dev';   // used in emails

/* ---------- helpers over the three tabs ---------- */

function toolsSheet()   { return tab(book(), 'Tools', TOOL_HEADERS); }
function loansSheet()   { return tab(book(), 'Loans', LOAN_HEADERS); }
function reviewsSheet() { return tab(book(), 'Reviews', REVIEW_HEADERS); }

function rowsOf(sheet, headers) {
  if (sheet.getLastRow() < 2) return [];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.map(function (r, i) {
    var o = { _row: i + 2 };
    headers.forEach(function (h, c) { o[h] = r[c]; });
    return o;
  });
}

function newId(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function memberByEmail(email) {
  var sheet = book().getSheetByName('Members');
  var row = findRowByEmail(sheet, email);
  if (!row) return null;
  var r = sheet.getRange(row, 1, 1, MEMBER_HEADERS.length).getValues()[0];
  return {
    email: String(r[3]).toLowerCase().trim(),
    name: (String(r[1]).trim() + ' ' + String(r[2]).trim()).trim(),
    first: String(r[1]).trim(),
    address: [ [r[5], r[6]].filter(String).join(' '), [r[7], r[8]].filter(String).join(', '), r[9] ]
               .filter(String).join('  ')
  };
}

/* ---------- reading ---------- */

/** The signed-in member's own tools, each with any live loan and review stats. */
function myLibrary(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });

  var tools = rowsOf(toolsSheet(), TOOL_HEADERS).filter(function (t) {
    return String(t['Email']).toLowerCase().trim() === email && t['Tool ID'];
  });
  var loans = rowsOf(loansSheet(), LOAN_HEADERS);
  var reviews = rowsOf(reviewsSheet(), REVIEW_HEADERS);

  var out = tools.map(function (t) {
    var tid = t['Tool ID'];
    var active = loans.filter(function (l) {
      return l['Tool ID'] === tid && (l['Status'] === 'pending' || l['Status'] === 'approved');
    });
    var pending = active.filter(function (l) { return l['Status'] === 'pending'; });
    var current = active.filter(function (l) { return l['Status'] === 'approved'; })[0] || null;

    return {
      id: tid,
      tool: t['Tool'],
      category: t['Category'],
      notes: t['Notes'],
      status: t['Status'] || 'available',
      pendingRequests: pending.map(loanCard),
      currentLoan: current ? loanCard(current) : null,
      rating: ratingFor(reviews, tid)
    };
  });

  return json({ ok: true, tools: out });
}

/** A single tool as any member sees it, for the borrow screen. */
function toolDetail(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });

  var t = rowsOf(toolsSheet(), TOOL_HEADERS).filter(function (x) {
    return x['Tool ID'] === d.toolId;
  })[0];
  if (!t) return json({ ok: false, error: 'That tool is no longer listed.' });

  var owner = memberByEmail(String(t['Email']).toLowerCase().trim());
  var reviews = rowsOf(reviewsSheet(), REVIEW_HEADERS);

  var mine = String(t['Email']).toLowerCase().trim() === email;
  var loans = rowsOf(loansSheet(), LOAN_HEADERS);
  var alreadyAsked = loans.some(function (l) {
    return l['Tool ID'] === d.toolId &&
      String(l['Borrower Email']).toLowerCase().trim() === email &&
      (l['Status'] === 'pending' || l['Status'] === 'approved');
  });

  return json({
    ok: true,
    tool: {
      id: t['Tool ID'],
      tool: t['Tool'],
      category: t['Category'],
      notes: t['Notes'],
      status: t['Status'] || 'available',
      ownerName: owner ? owner.name : t['Member'],
      isMine: mine,
      alreadyAsked: alreadyAsked,
      rating: ratingFor(reviews, d.toolId),
      reviews: reviews.filter(function (r) { return r['Tool ID'] === d.toolId; })
        .map(publicReview)
        .sort(function (a, b) { return new Date(b.created) - new Date(a.created); })
    }
  });
}

/** Everything the signed-in member is involved in: as borrower and as owner. */
function myLoans(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });

  var loans = rowsOf(loansSheet(), LOAN_HEADERS);
  var reviews = rowsOf(reviewsSheet(), REVIEW_HEADERS);

  function decorate(l) {
    var card = loanCard(l);
    card.myReviewLeft = reviews.some(function (r) {
      return r['Loan ID'] === l['Loan ID'] &&
        String(r['Reviewer Email']).toLowerCase().trim() === email;
    });
    card.canReview = card.status === 'returned' && !card.myReviewLeft &&
      withinReviewWindow(l['Returned']);
    return card;
  }

  return json({
    ok: true,
    borrowing: loans.filter(function (l) {
      return String(l['Borrower Email']).toLowerCase().trim() === email;
    }).map(decorate),
    lending: loans.filter(function (l) {
      return String(l['Owner Email']).toLowerCase().trim() === email;
    }).map(decorate)
  });
}

/* ---------- shaping ---------- */

function loanCard(l) {
  return {
    id: l['Loan ID'],
    toolId: l['Tool ID'],
    toolName: l['Tool Name'],
    ownerName: l['Owner Name'],
    ownerEmail: l['Owner Email'],
    borrowerName: l['Borrower Name'],
    borrowerEmail: l['Borrower Email'],
    borrowerAddress: l['Status'] === 'approved' || l['Status'] === 'returned' ? l['Borrower Address'] : '',
    status: l['Status'],
    message: l['Message'],
    requested: iso(l['Requested']),
    due: iso(l['Due']),
    returned: iso(l['Returned'])
  };
}

function publicReview(r) {
  return {
    reviewerName: r['Reviewer Name'],
    direction: r['Direction'],
    rating: Number(r['Rating']) || 0,
    comment: String(r['Comment'] || ''),
    created: iso(r['Created'])
  };
}

function ratingFor(reviews, toolId) {
  var rs = reviews.filter(function (r) {
    return r['Tool ID'] === toolId && r['Direction'] === 'of_owner';
  });
  if (!rs.length) return { count: 0, average: 0 };
  var sum = rs.reduce(function (a, r) { return a + (Number(r['Rating']) || 0); }, 0);
  return { count: rs.length, average: Math.round((sum / rs.length) * 10) / 10 };
}

function iso(v) { return v ? new Date(v).toISOString() : ''; }

function withinReviewWindow(returnedAt) {
  if (!returnedAt) return false;
  var end = new Date(returnedAt).getTime() + REVIEW_WINDOW_DAYS * 86400000;
  return Date.now() <= end;
}

/* ---------- editing the library ---------- */

function saveTool(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });
  if (!d.tool || !String(d.tool).trim()) return json({ ok: false, error: 'Give the tool a name.' });

  var me = memberByEmail(email);
  var sheet = toolsSheet();

  if (d.id) {
    var rows = rowsOf(sheet, TOOL_HEADERS);
    var found = rows.filter(function (t) {
      return t['Tool ID'] === d.id && String(t['Email']).toLowerCase().trim() === email;
    })[0];
    if (!found) return json({ ok: false, error: 'That tool is not in your library.' });
    sheet.getRange(found._row, 5, 1, 3).setValues([[ String(d.tool).trim(), d.category || '', d.notes || '' ]]);
    return json({ ok: true, id: d.id });
  }

  var id = newId('tool');
  sheet.appendRow([ id, new Date(), email, me ? me.name : '', String(d.tool).trim(), d.category || '', d.notes || '', 'available' ]);
  syncToolCount(email);
  return json({ ok: true, id: id });
}

function deleteTool(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });

  var loans = rowsOf(loansSheet(), LOAN_HEADERS);
  var live = loans.some(function (l) {
    return l['Tool ID'] === d.id && (l['Status'] === 'pending' || l['Status'] === 'approved');
  });
  if (live) return json({ ok: false, error: 'Sort out the open request or loan on this tool first.' });

  var sheet = toolsSheet();
  var found = rowsOf(sheet, TOOL_HEADERS).filter(function (t) {
    return t['Tool ID'] === d.id && String(t['Email']).toLowerCase().trim() === email;
  })[0];
  if (!found) return json({ ok: false, error: 'That tool is not in your library.' });

  sheet.deleteRow(found._row);
  syncToolCount(email);
  return json({ ok: true });
}

function setToolStatus(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });
  if (['available', 'paused'].indexOf(d.status) < 0) return json({ ok: false, error: 'Unknown status.' });

  var sheet = toolsSheet();
  var found = rowsOf(sheet, TOOL_HEADERS).filter(function (t) {
    return t['Tool ID'] === d.id && String(t['Email']).toLowerCase().trim() === email;
  })[0];
  if (!found) return json({ ok: false, error: 'That tool is not in your library.' });
  if (found['Status'] === 'on loan') return json({ ok: false, error: 'It is out on loan right now.' });

  sheet.getRange(found._row, 8).setValue(d.status);
  return json({ ok: true });
}

function syncToolCount(email) {
  var members = book().getSheetByName('Members');
  var row = findRowByEmail(members, email);
  if (!row) return;
  var count = rowsOf(toolsSheet(), TOOL_HEADERS).filter(function (t) {
    return String(t['Email']).toLowerCase().trim() === email && t['Tool ID'];
  }).length;
  members.getRange(row, 15).setValue(count > 0 ? 'Yes' : 'No'); // Tool Sharing
  members.getRange(row, 16).setValue(count);                    // Tool Count
}

/* ---------- the borrow lifecycle ---------- */

function requestLoan(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });
  if (!d.consent) return json({ ok: false, error: 'Please agree to the lending terms first.' });

  var tool = rowsOf(toolsSheet(), TOOL_HEADERS).filter(function (t) { return t['Tool ID'] === d.toolId; })[0];
  if (!tool) return json({ ok: false, error: 'That tool is no longer listed.' });

  var ownerEmail = String(tool['Email']).toLowerCase().trim();
  if (ownerEmail === email) return json({ ok: false, error: "That's your own tool." });
  if (tool['Status'] !== 'available') return json({ ok: false, error: 'That tool is not available right now.' });

  var loans = rowsOf(loansSheet(), LOAN_HEADERS);
  var dupe = loans.some(function (l) {
    return l['Tool ID'] === d.toolId &&
      String(l['Borrower Email']).toLowerCase().trim() === email &&
      (l['Status'] === 'pending' || l['Status'] === 'approved');
  });
  if (dupe) return json({ ok: false, error: 'You already have a request open on this tool.' });

  var owner = memberByEmail(ownerEmail);
  var borrower = memberByEmail(email);
  var id = newId('loan');

  loansSheet().appendRow([
    id, d.toolId, tool['Tool'],
    ownerEmail, owner ? owner.name : tool['Member'],
    email, borrower ? borrower.name : '', borrower ? borrower.address : '',
    'pending', String(d.message || '').slice(0, 500),
    new Date(), '', d.due ? new Date(d.due) : '', ''
  ]);

  email_(ownerEmail,
    borrower.first + ' would like to borrow your ' + tool['Tool'],
    [
      (owner ? 'Hi ' + owner.first + ',' : 'Hi,'), '',
      borrower.name + ' asked to borrow your ' + tool['Tool'] + '.',
      d.due ? 'They suggested returning it by ' + prettyDate(d.due) + '.' : '',
      d.message ? '' : '', d.message ? 'They said: "' + d.message + '"' : '',
      '', 'Approve or decline it in your tool library:',
      SITE_URL + '/library.html', '',
      'Avondale Gardening Alliance'
    ].filter(function (x) { return x !== null && x !== undefined; }).join('\n')
  );

  return json({ ok: true, id: id });
}

function decideLoan(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });

  var sheet = loansSheet();
  var loan = rowsOf(sheet, LOAN_HEADERS).filter(function (l) { return l['Loan ID'] === d.loanId; })[0];
  if (!loan) return json({ ok: false, error: 'That request is gone.' });
  if (String(loan['Owner Email']).toLowerCase().trim() !== email) return json({ ok: false, error: 'That is not your tool.' });
  if (loan['Status'] !== 'pending') return json({ ok: false, error: 'That request was already handled.' });

  var borrower = memberByEmail(String(loan['Borrower Email']).toLowerCase().trim());

  if (d.approve) {
    // decline every other pending request on this tool, the tool is spoken for
    var others = rowsOf(sheet, LOAN_HEADERS).filter(function (l) {
      return l['Tool ID'] === loan['Tool ID'] && l['Status'] === 'pending' && l['Loan ID'] !== loan['Loan ID'];
    });
    others.forEach(function (o) {
      sheet.getRange(o._row, 9).setValue('declined');
      sheet.getRange(o._row, 12).setValue(new Date());
      email_(String(o['Borrower Email']).toLowerCase().trim(),
        'Your request for the ' + o['Tool Name'] + ' was declined',
        'That tool just went out to someone else. Have a look at what else neighbors are sharing:\n' + SITE_URL + '/library.html\n\nAvondale Gardening Alliance');
    });

    sheet.getRange(loan._row, 9).setValue('approved');
    sheet.getRange(loan._row, 12).setValue(new Date());
    setToolStatusRaw(loan['Tool ID'], 'on loan');

    email_(String(loan['Borrower Email']).toLowerCase().trim(),
      'You can borrow the ' + loan['Tool Name'],
      [
        (borrower ? 'Hi ' + borrower.first + ',' : 'Hi,'), '',
        loan['Owner Name'] + ' said yes. Reach out to arrange a pickup:',
        String(loan['Owner Email']).toLowerCase().trim(),
        loan['Due'] ? 'Please return it by ' + prettyDate(loan['Due']) + '.' : '',
        '', 'Avondale Gardening Alliance'
      ].filter(String).join('\n'));

    return json({ ok: true, status: 'approved' });
  }

  sheet.getRange(loan._row, 9).setValue('declined');
  sheet.getRange(loan._row, 12).setValue(new Date());
  email_(String(loan['Borrower Email']).toLowerCase().trim(),
    'Your request for the ' + loan['Tool Name'] + ' was declined',
    (borrower ? 'Hi ' + borrower.first + ',\n\n' : 'Hi,\n\n') +
    loan['Owner Name'] + " isn't able to lend the " + loan['Tool Name'] + ' right now.\n\nAvondale Gardening Alliance');
  return json({ ok: true, status: 'declined' });
}

function markReturned(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });

  var sheet = loansSheet();
  var loan = rowsOf(sheet, LOAN_HEADERS).filter(function (l) { return l['Loan ID'] === d.loanId; })[0];
  if (!loan) return json({ ok: false, error: 'That loan is gone.' });
  if (String(loan['Owner Email']).toLowerCase().trim() !== email) return json({ ok: false, error: 'That is not your tool.' });
  if (loan['Status'] !== 'approved') return json({ ok: false, error: 'That loan is not active.' });

  sheet.getRange(loan._row, 9).setValue('returned');
  sheet.getRange(loan._row, 14).setValue(new Date());
  setToolStatusRaw(loan['Tool ID'], 'available');

  email_(String(loan['Borrower Email']).toLowerCase().trim(),
    'Thanks for returning the ' + loan['Tool Name'],
    'Marked returned. You have ' + REVIEW_WINDOW_DAYS + ' days to leave ' + loan['Owner Name'] +
    ' a review, and they can leave you one too:\n' + SITE_URL + '/loans.html\n\nAvondale Gardening Alliance');

  return json({ ok: true });
}

function cancelLoan(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });

  var sheet = loansSheet();
  var loan = rowsOf(sheet, LOAN_HEADERS).filter(function (l) { return l['Loan ID'] === d.loanId; })[0];
  if (!loan) return json({ ok: false, error: 'That request is gone.' });
  if (String(loan['Borrower Email']).toLowerCase().trim() !== email) return json({ ok: false, error: 'That is not your request.' });
  if (loan['Status'] !== 'pending') return json({ ok: false, error: 'Too late to cancel that one.' });

  sheet.getRange(loan._row, 9).setValue('cancelled');
  return json({ ok: true });
}

function setToolStatusRaw(toolId, status) {
  var sheet = toolsSheet();
  var found = rowsOf(sheet, TOOL_HEADERS).filter(function (t) { return t['Tool ID'] === toolId; })[0];
  if (found) sheet.getRange(found._row, 8).setValue(status);
}

/* ---------- reviews ---------- */

function leaveReview(d) {
  var email = sessionEmail(d.token);
  if (!email) return json({ ok: false, error: 'signed out' });

  var rating = Number(d.rating);
  if (!(rating >= 1 && rating <= 5)) return json({ ok: false, error: 'Pick a rating from 1 to 5.' });

  var loan = rowsOf(loansSheet(), LOAN_HEADERS).filter(function (l) { return l['Loan ID'] === d.loanId; })[0];
  if (!loan) return json({ ok: false, error: 'That loan is gone.' });
  if (loan['Status'] !== 'returned') return json({ ok: false, error: 'You can review once the tool is back.' });
  if (!withinReviewWindow(loan['Returned'])) return json({ ok: false, error: 'The review window has closed.' });

  var isOwner = String(loan['Owner Email']).toLowerCase().trim() === email;
  var isBorrower = String(loan['Borrower Email']).toLowerCase().trim() === email;
  if (!isOwner && !isBorrower) return json({ ok: false, error: 'You were not part of this loan.' });

  var sheet = reviewsSheet();
  var already = rowsOf(sheet, REVIEW_HEADERS).some(function (r) {
    return r['Loan ID'] === d.loanId && String(r['Reviewer Email']).toLowerCase().trim() === email;
  });
  if (already) return json({ ok: false, error: 'You already reviewed this one.' });

  var me = memberByEmail(email);
  var subjectEmail = isOwner ? String(loan['Borrower Email']).toLowerCase().trim()
                             : String(loan['Owner Email']).toLowerCase().trim();

  sheet.appendRow([
    newId('rev'), d.loanId, loan['Tool ID'],
    email, me ? me.name : '',
    subjectEmail, isOwner ? 'of_borrower' : 'of_owner',
    rating, String(d.comment || '').slice(0, 600), new Date()
  ]);

  return json({ ok: true });
}

function prettyDate(v) {
  return Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), 'EEE, MMM d');
}

/** Sends mail, but never lets a mail failure abort the action it follows. */
function email_(to, subject, body) {
  try {
    MailApp.sendEmail({ to: to, subject: subject, body: body });
  } catch (err) {
    Logger.log('email to ' + to + ' failed: ' + err);
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
