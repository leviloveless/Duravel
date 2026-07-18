# Duravel — Google Sheets Lead-Capture Backend (unlimited, free)

> **UPDATED 2026-07-15 — auto-email enabled.** The canonical script is now `marketing/apps-script/pace-capture.gs` (it adds a `MailApp.sendEmail` block that sends each consenting signup the pacing guide, plus a `guide_sent` column). **Paste that file**, not the inline copy below, and set `MAILING_ADDRESS` at the top to the Northwest registered-agent address before deploying.

For the DekaFit `/pace` page. Replaces Formspree; no submission cap. ~10 minutes.

The page (`public/pace.html`) is **already wired for this** — it sends a `text/plain` + `no-cors` request, which is exactly what a Google Apps Script Web App accepts. All that's left is to stand up the script and paste its URL.

---

## 1. Create the Sheet
Signed in as **levi.loveless@duravel.app**, create a new Google Sheet and name it "Duravel — Pace Leads".

## 2. Add the script
- **Extensions → Apps Script.**
- Delete the default `function myFunction() {}`.
- Paste the code below (also saved in your repo at `marketing/apps-script/pace-capture.gs`), then **Save**.

```javascript
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // serialize writes under race-day load
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Leads') || ss.insertSheet('Leads');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['received_at', 'captured_at', 'first_name', 'email', 'source', 'consent']);
    }
    var data = {};
    if (e && e.postData && e.postData.contents) {
      try { data = JSON.parse(e.postData.contents); }
      catch (parseErr) { data = (e && e.parameter) || {}; }
    } else {
      data = (e && e.parameter) || {};
    }
    sheet.appendRow([
      new Date().toISOString(),
      data.captured_at || '',
      String(data.first_name || '').slice(0, 100),
      String(data.email || '').slice(0, 200),
      String(data.source || '').slice(0, 60),
      (data.consent === true || data.consent === 'true') ? 'yes' : 'no'
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

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ result: 'ok', service: 'duravel-pace-capture' }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## 3. Deploy as a Web App
- **Deploy → New deployment.**
- Click the gear → select type **Web app**.
- Description: "Duravel pace capture".
- **Execute as: Me** (levi.loveless@duravel.app).
- **Who has access: Anyone** ← must be "Anyone", *not* "Anyone with a Google account", or public visitors get a login redirect and the POST silently fails.
- **Deploy** → Authorize access → choose your account → (if warned) Advanced → "Go to … (unsafe)" → **Allow**. That warning is normal for your own script.
- Copy the **Web app URL** — it ends in `/exec`.

## 4. Connect the page
In `public/pace.html`, set:
```javascript
var FORM_ENDPOINT = "https://script.google.com/macros/s/XXXXXXXX/exec";
```
(and fill the footer mailing address while you're in there.)

## 5. Test
- **Quick check:** paste the `/exec` URL into a browser — you should see `{"result":"ok","service":"duravel-pace-capture"}` (that's `doGet`). Confirms it's deployed and public.
- **Full check (after `npm run build` + push):** open `https://duravel.app/pace?src=dekafit` on your phone, submit a real test → a row should appear in the Sheet's **Leads** tab with `source = dekafit`.
- **Important:** the page shows "success" optimistically — cross-origin rules mean it can't read Apps Script's reply, so it assumes the send worked. **Always confirm the row actually landed in the Sheet** when testing, not just the on-screen success message.

---

## Two gotchas worth knowing
- **Editing the script later:** changes don't go live until you redeploy. Use **Deploy → Manage deployments → (pencil) Edit → Version: New version → Deploy** — this keeps the *same* `/exec` URL. A fresh "New deployment" gives a *new* URL you'd have to re-paste into the page.
- **Guide delivery:** unlike Formspree, Apps Script has no built-in autoresponder, so signups won't automatically receive the pacing guide. For DekaFit the simplest path is to export the Sheet after the race and batch-send the guide from your Duravel inbox. If you'd rather it auto-email each signup the PDF on submit, I can add a `MailApp.sendEmail(...)` block to `doPost` (you're on Workspace, so you have ~1,500 sends/day) — just ask.
