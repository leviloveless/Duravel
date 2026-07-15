/**
 * Duravel - lead-capture backend for the /pace race page.
 * Receives JSON POSTs from public/pace.html and appends one row per signup,
 * then auto-emails the signup their HYROX pacing guide.
 * The page sends text/plain (a CORS "simple" request), so no preflight is needed.
 *
 * DEPLOY: Deploy > Web app > Execute as: Me > Who has access: Anyone.
 * Editing later: Deploy > Manage deployments > Edit (pencil) > Version: New version
 * to keep the SAME /exec URL.
 */

// ---- Config: fill these before deploying ----
var GUIDE_URL       = 'https://duravel.app/hyrox-pacing-guide.pdf';
var FROM_NAME       = 'Duravel';
// CAN-SPAM requires a real physical postal address in every commercial email.
var MAILING_ADDRESS = '5900 Balcones Dr STE 100, Austin, TX 78731';
// ---------------------------------------------

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // serialize writes under race-day load
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Leads') || ss.insertSheet('Leads');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['received_at', 'captured_at', 'first_name', 'email', 'source', 'consent', 'guide_sent']);
    }
    var data = {};
    if (e && e.postData && e.postData.contents) {
      try { data = JSON.parse(e.postData.contents); }
      catch (parseErr) { data = (e && e.parameter) || {}; }
    } else {
      data = (e && e.parameter) || {};
    }

    var firstName = String(data.first_name || '').slice(0, 100);
    var email     = String(data.email || '').slice(0, 200).trim();
    var source    = String(data.source || '').slice(0, 60);
    var consent   = (data.consent === true || data.consent === 'true');

    // Auto-send the guide (only to consenting signups with a plausible email).
    // Wrapped so a mail failure can NEVER lose the lead row.
    var guideSent = 'no';
    if (consent && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      try {
        MailApp.sendEmail({
          to: email,
          name: FROM_NAME,
          subject: 'Your HYROX pacing guide',
          htmlBody: buildGuideEmail(firstName)
        });
        guideSent = 'yes';
      } catch (mailErr) {
        guideSent = 'error';
      }
    }

    sheet.appendRow([
      new Date().toISOString(),
      data.captured_at || '',
      firstName,
      email,
      source,
      consent ? 'yes' : 'no',
      guideSent
    ]);
    return ContentService.createTextOutput(JSON.stringify({ result: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function buildGuideEmail(firstName) {
  var hi = firstName ? ('Hi ' + firstName + ',') : 'Hi,';
  return '' +
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111;">' +
      '<p>' + hi + '</p>' +
      '<p>Thanks for stopping by at the race. Here\'s your HYROX pacing guide:</p>' +
      '<p><a href="' + GUIDE_URL + '" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Download the HYROX pacing guide (PDF)</a></p>' +
      '<p>Or paste this link into your browser:<br><a href="' + GUIDE_URL + '">' + GUIDE_URL + '</a></p>' +
      '<p>We\'ll send the occasional training tip from Duravel. Not interested? Just reply with "unsubscribe" and you\'re off the list.</p>' +
      '<hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">' +
      '<p style="font-size:12px;color:#777;">' + FROM_NAME + ' &middot; ' + MAILING_ADDRESS + '</p>' +
    '</div>';
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ result: 'ok', service: 'duravel-pace-capture' }))
    .setMimeType(ContentService.MimeType.JSON);
}
