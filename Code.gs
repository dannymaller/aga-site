/**
 * Avondale Gardening Alliance - membership intake
 *
 * SHEET_ID is already filled in below.
 *
 * AFTER PASTING THIS IN:
 * 1. Save.
 * 2. Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
 * 3. Run backfill() from the editor to place any rows that have no
 *    coordinates yet.
 *
 * AFTER ANY CODE CHANGE: Deploy > Manage deployments > pencil icon >
 * Version: New version > Deploy. Saving alone does not update the live URL.
 */

// AGA members sheet.
var SHEET_ID = '1Mnvu5BRsHmhhwGbkpeJYgVLaB22vr_rZZIMKWlKo2gY';

// The map shows first name plus last initial. Flip to true for full names.
var SHOW_FULL_LAST_NAME = false;

var MEMBER_HEADERS = [
  'Timestamp', 'First Name', 'Last Name', 'Email', 'Phone',
  'Street', 'Unit', 'City', 'State', 'ZIP', 'Lat', 'Lng',
  'Interests', 'About', 'Tool Sharing', 'Tool Count', 'Tool Notes', 'Consent',
  'Geocode Source'
];

var TOOL_HEADERS = ['Timestamp', 'Email', 'Member', 'Tool', 'Category', 'Notes'];

// Sign-in codes. Codes are stored hashed, never in the clear.
var AUTH_HEADERS = ['Email', 'Code Hash', 'Expires', 'Attempts', 'Sent At'];

// Logged-in browsers. Tokens are stored hashed too.
var SESSION_HEADERS = ['Token Hash', 'Email', 'Created', 'Expires'];

var CODE_MINUTES = 10;      // how long an emailed code is good for
var SESSION_DAYS = 30;      // how long a browser stays signed in
var MAX_ATTEMPTS = 5;       // wrong codes before the code is burned
var RESEND_SECONDS = 60;    // throttle on asking for another code

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var d = JSON.parse(e.postData.contents);

    // Everything except sign-up arrives with an action
    switch (d.action) {
      case 'requestCode': return requestCode(d);
      case 'verifyCode':  return verifyCode(d);
      case 'me':          return me(d);
      case 'members':     return memberList(d);
      case 'signOut':     return signOut(d);
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
      d.toolSharing ? 'Yes' : 'No',
      toolList.length,
      d.toolNotes || '',
      d.consent ? 'Yes' : 'No',
      source
    ];

    // If this email already signed up, update that row instead of adding a duplicate.
    var existing = findRowByEmail(members, d.email);
    if (existing) {
      members.getRange(existing, 1, 1, row.length).setValues([row]);
      clearToolsFor(tools, d.email);
    } else {
      members.appendRow(row);
    }

    toolList.forEach(function (t) {
      tools.appendRow([now, d.email, name, t.tool, t.category || '', t.notes || '']);
    });

    return json({ ok: true, updated: !!existing });
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

  return json({ ok: true, service: 'AGA membership intake' });
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

  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var now = new Date();
  var expiresAt = new Date(now.getTime() + SESSION_DAYS * 86400000);
  tab(book(), 'Sessions', SESSION_HEADERS).appendRow([sha(token), email, now, expiresAt]);

  return json({ ok: true, token: token, expires: expiresAt.toISOString(), profile: profileOf(email) });
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
    tools: groupTools()[String(email).toLowerCase().trim()] || []
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
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TOOL_HEADERS.length).getValues();
  rows.forEach(function (r) {
    var email = String(r[1] || '').toLowerCase().trim();
    if (!email || !r[3]) return;
    if (!map[email]) map[email] = [];
    map[email].push({ tool: String(r[3]).trim(), category: String(r[4] || '').trim(), notes: String(r[5] || '').trim() });
  });
  return map;
}

/* ---------- helpers ---------- */

/**
 * Opens the spreadsheet. Uses SHEET_ID when set, otherwise falls back to the
 * sheet this script is bound to. Throws a readable error if neither works.
 */
function book() {
  if (SHEET_ID) return SpreadsheetApp.openById(SHEET_ID);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
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

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
