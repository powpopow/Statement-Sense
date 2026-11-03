// Statement Sense backend. Bound to the Statement Sense Data sheet.
//
// The browser never touches the sheet. It sends a Google ID token with every
// request; this script checks the token was issued for this app, then checks the
// email against the "Allowed" tab of this same sheet (so the list of who may get
// in is never in the public code). Rows are merged by key, newest change wins,
// under a lock, so two devices syncing at once cannot overwrite each other.

// The OAuth client ID of the web app; an ID token's `aud` must equal it.
var CLIENT_ID = '117383740061-5v1c4iua42qq9gebl5d0nesgr50gseok.apps.googleusercontent.com';

// Tab name -> { key column, columns }. Must match src/lib/sheets.ts.
var TABS = {
  Transactions: {
    key: 'id',
    cols: ['id', 'date', 'postedDate', 'description', 'amount', 'currency', 'foreignAmount', 'foreignCurrency',
      'category', 'categoryLocked', 'source', 'sourceFile', 'confidence', 'notes', 'matchedOrderId', 'owner',
      'account', 'accountName', 'updatedAt', 'deleted'],
  },
  Orders: {
    key: 'id',
    cols: ['id', 'platform', 'date', 'orderRef', 'description', 'amount', 'currency', 'items', 'sourceFile',
      'confidence', 'matchedTransactionId', 'owner', 'updatedAt', 'deleted'],
  },
  Rules: { key: 'id', cols: ['id', 'pattern', 'matchType', 'category', 'priority', 'enabled', 'updatedAt', 'deleted'] },
  Cash: { key: 'month', cols: ['month', 'amount', 'note', 'updatedAt', 'deleted'] },
  Statements: { key: 'id', cols: ['id', 'bank', 'last4', 'periodEnd', 'opening', 'closing', 'net', 'sourceFile'] },
};

// Columns holding numbers; everything else is stored as text so ids, dates and
// descriptions are never reinterpreted (a date string turned into a Date, say).
var NUMERIC = { amount: 1, foreignAmount: 1, confidence: 1, priority: 1, updatedAt: 1, opening: 1, closing: 1, net: 1 };

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ── auth ─────────────────────────────────────────────────────────────────────

var authReason_ = '';

function verifyIdToken_(token) {
  if (!token || typeof token !== 'string' || token.length > 4096) { authReason_ = 'no token'; return null; }
  var cache = CacheService.getScriptCache();
  var key = 'idt_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var hit = cache.get(key);
  if (hit) return hit;

  var info;
  try {
    var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) { authReason_ = 'tokeninfo HTTP ' + resp.getResponseCode(); return null; }
    info = JSON.parse(resp.getContentText());
  } catch (err) { authReason_ = 'tokeninfo fetch failed'; return null; }

  if (info.aud !== CLIENT_ID) { authReason_ = 'client id mismatch'; return null; }
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') { authReason_ = 'bad issuer'; return null; }
  if (String(info.email_verified) !== 'true' || !info.email) { authReason_ = 'email unverified'; return null; }
  var ttl = Number(info.exp) - Math.floor(Date.now() / 1000);
  if (!(ttl > 0)) { authReason_ = 'token expired'; return null; }

  var email = String(info.email).toLowerCase();
  cache.put(key, email, Math.min(ttl, 21600));
  return email;
}

// Read fresh each request, so removing an email takes effect immediately.
function isAllowed_(email) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Allowed');
  if (!sheet) return false;
  return sheet.getDataRange().getValues().some(function (row) {
    return String(row[0]).trim().toLowerCase() === email;
  });
}

// ── entry points ─────────────────────────────────────────────────────────────

function doGet() {
  return json_({ ok: false, error: 'unauthorized' });
}

function doPost(e) {
  var data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }

  var email = verifyIdToken_(data.idToken);
  if (!email || !isAllowed_(email)) {
    return json_({ ok: false, error: 'unauthorized', reason: email ? 'email not in allow-list' : authReason_ });
  }

  try {
    if (data.action === 'whoami') return json_({ ok: true, email: email });
    if (data.action === 'ping') return json_({ ok: true, rev: getRev_() });
    if (data.action === 'pull') return json_({ ok: true, rev: getRev_(), tabs: pull_(data.since) });
    if (data.action === 'push') return json_(push_(data.tabs));
  } catch (err) {
    console.error('error: ' + err);
    return json_({ ok: false, error: 'server error' });
  }
  return json_({ ok: false, error: 'unknown action' });
}

// ── data ─────────────────────────────────────────────────────────────────────

function getRev_() {
  return Number(PropertiesService.getScriptProperties().getProperty('rev') || 0);
}

// A sheet that has the tab, with every expected column in its header row.
function tabSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var cols = TABS[name].cols;
  var width = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (h) { return String(h).trim(); });
  cols.forEach(function (c) {
    if (header.indexOf(c) === -1) {
      header = header.filter(function (h) { return h !== ''; });
      header.push(c);
      sheet.getRange(1, header.length).setValue(c);
    }
  });
  sheet.setFrozenRows(1);
  return { sheet: sheet, header: header };
}

function cellText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
  var s = String(v);
  // Undo the guard added on write (see safeText_).
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

function readRows_(name) {
  var t = tabSheet_(name);
  var last = t.sheet.getLastRow();
  if (last < 2) return { t: t, rows: [] };
  var values = t.sheet.getRange(2, 1, last - 1, t.header.length).getValues();
  var rows = values.map(function (r) {
    var o = {};
    t.header.forEach(function (h, i) { if (h) o[h] = NUMERIC[h] && r[i] !== '' ? Number(r[i]) : cellText_(r[i]); });
    return o;
  }).filter(function (o) { return o[TABS[name].key] !== ''; });
  return { t: t, rows: rows };
}

function pull_(since) {
  var out = {};
  Object.keys(TABS).forEach(function (name) {
    var rows = readRows_(name).rows;
    // Rows that predate stamping have no updatedAt and are always sent.
    if (since) rows = rows.filter(function (r) { return !r.updatedAt || r.updatedAt > since; });
    out[name] = rows;
  });
  return out;
}

// A text cell starting with = + - @ would be run as a formula, so it is stored
// with a leading apostrophe. Numbers are not affected.
function safeText_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) && !/^-?\d/.test(v) ? "'" + v : v;
}

function push_(tabs) {
  if (!tabs || typeof tabs !== 'object') return { ok: false, error: 'bad request' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    var applied = {};
    Object.keys(tabs).forEach(function (name) {
      if (!TABS[name] || !Array.isArray(tabs[name])) return;
      applied[name] = upsert_(name, tabs[name]);
    });
    var rev = getRev_() + 1;
    PropertiesService.getScriptProperties().setProperty('rev', String(rev));
    return { ok: true, rev: rev, applied: applied };
  } finally {
    lock.releaseLock();
  }
}

// Insert or replace rows by key. An existing row is kept if it is newer.
function upsert_(name, incoming) {
  var spec = TABS[name];
  var read = readRows_(name);
  var header = read.t.header;
  var index = {};
  read.rows.forEach(function (r, i) { index[r[spec.key]] = i; });

  var current = read.rows.map(function (r) { return header.map(function (h) { return r[h] === undefined ? '' : r[h]; }); });
  var applied = 0;
  incoming.forEach(function (row) {
    var k = row && row[spec.key];
    if (k === undefined || k === null || k === '') return;
    k = String(k);
    var at = index[k];
    if (at !== undefined && Number(read.rows[at].updatedAt || 0) > Number(row.updatedAt || 0)) return;
    var cells = header.map(function (h) {
      var v = row[h];
      if (v === undefined || v === null) return '';
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      return NUMERIC[h] ? Number(v) : safeText_(String(v));
    });
    if (at === undefined) { index[k] = current.length; current.push(cells); read.rows.push(row); } else current[at] = cells;
    applied++;
  });
  if (applied && current.length) {
    var range = read.t.sheet.getRange(2, 1, current.length, header.length);
    // Text columns are set to plain text first, so nothing is reinterpreted.
    header.forEach(function (h, i) {
      read.t.sheet.getRange(2, i + 1, current.length, 1).setNumberFormat(NUMERIC[h] ? '0.########' : '@');
    });
    range.setValues(current);
  }
  return applied;
}
