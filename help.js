// In-app help. Short, role-based, written for people on a phone. The long version is the User Guide document.
// Keep this file free of sheet names and technical terms: when something has to change "behind the scenes", the answer is "contact your manager".
// Each section: { title, html }. html is trusted, written here (never built from user input).

const HELP = {
  SUPERVISOR: [
    { title: 'Home and your property schedule', html:
      '<p>The card at the top of Home shows where you are today and where you go next, with the address, the host and the caretaker.</p>' +
      '<ul><li><b>Check-in time:</b> a new property starts after 12:00 and can run until 16:00. Before 12:00 you are still at yesterday\'s property and today\'s shows as <b>Next</b>. From 12:00 today\'s property moves up. Between 12:00 and 16:00 the previous property stays visible as "until you check in".</li>' +
      '<li><b>Open in Maps</b> opens the property in Google Maps. <b>Directions</b> starts navigation.</li>' +
      '<li><b>Call</b> dials the host or caretaker. <b>Copy</b> copies the number.</li>' +
      '<li><b>Past properties</b> lists your earlier properties from the last 30 days.</li>' +
      '<li>"Address not added yet" or "No host or caretaker number added yet" means the details are not filled in. Contact your manager.</li></ul>' +
      '<p>Below it, Home lists the assets with your team: everything recorded in your location group, with today\'s property named beside it. Tap a device for its menu. Tick several to report an issue, send or assign them together.</p>' },
    { title: 'Last scan and location', html:
      '<p>Home shows when your location was last checked today, or your last attendance scan, whichever is newer.</p>' +
      '<ul><li><b>At &lt;property&gt;</b> (green): you are within about 1 km of the property you are scheduled for.</li>' +
      '<li><b>Not at your scheduled property</b> (amber): you were somewhere else.</li>' +
      '<li><b>No location or scan yet today</b>: scan in at your property, and allow location when the app asks.</li></ul>' +
      '<p>If you have a property starting today and you are not at it by 14:00, admins are alerted. If you decline location, the app uses your attendance scan instead.</p>' },
    { title: 'Assign devices and SD cards to your team', html:
      '<p>The Assign screen shows one card per person: your team, plus anyone who scanned in at your property today. Each card has a Device slot and SD card slots.</p>' +
      '<ol><li>Pick the asset from the list in each slot.</li><li>Tap <b>Save changes</b>.</li></ol>' +
      '<p><b>Take all off</b> clears one person. <b>Still with same people</b> confirms nothing has changed (the app asks every 4 hours between 07:00 and 21:00). People who are not registered in the Awign app show "Not registered in the Awign app yet"; you can still assign to them.</p>' },
    { title: 'Invoices', html:
      '<p>Open <b>Invoices</b> and press <b>New invoice</b>: choose what it is for (a transfer, a check-in, props bought, or something else), then the amount, the logistic brand and the date, and add 1-3 pictures or PDF files of the invoice (a PDF can be up to 3 MB). For props bought, say what was bought in the note.</p>' +
      '<p>Pressing <b>Submit invoice</b> saves it on your phone first, so it still goes through if the signal drops or you close the app. The <b>Waiting to send</b> list shows anything that has not reached the server yet; it is sent again by itself, or press <b>Send now</b>. If an admin has asked for an invoice, it appears under <b>Asked for by an admin</b>: press <b>Send this invoice</b>. An invoice that is sent back shows the reason; send a better one.</p>' },
    { title: 'Send assets and confirm receipt', html:
      '<ol><li>Open <b>Transfers</b> and choose where to send: the Office or another supervisor.</li><li>Tick the assets and send.</li></ol>' +
      '<p>A photo is optional and never slows you down: the send goes through at once and the photo uploads in the background while you carry on. A note at the bottom shows it is still uploading; if it fails, tap the note to try again.</p>' +
      '<p>The receiver ticks only what actually arrived. Anything not ticked is flagged as a short receipt for an admin to settle. You can cancel a transfer that is still in transit. You cannot confirm a transfer you sent yourself.</p>' +
      '<p>At the bottom, <b>Transfer history</b> lists the last 6 closed transfers. Pick From and To dates to look further back; tap <b>Latest 6</b> to go back.</p>' },
    { title: 'Report an issue', html:
      '<p>Open <b>Report issue</b>, select one or many assets, choose the issue type for each, add a photo if it helps, and submit. Faulty devices stop counting as working and cannot be assigned until an admin resolves the issue.</p>' },
    { title: 'Asset check-in', html:
      '<p>Devices belong to a property, not to a person. When you move to another property (the day starts at 12:00), <b>Check in</b> shows two lists: the assets you hold that are still recorded at your <b>old property</b>, and the assets that were <b>already at the new property</b>. Tick the ones you really have here: your old ones move with you, and the ones you find here become yours.</p>' +
      '<p>If you leave out something that was already at the new property, the app asks if you really do not have it. Anything you do not tick stays with the person it is recorded with. If nobody ticks it at two check-ins in a row, the admins are alerted with its history.</p>' },
    { title: 'Search and alerts', html:
      '<p><b>Search</b> finds an asset and shows its full history. Start typing part of an ID, a kind, a holder or a place and matching assets appear below the box; tap one to open it. The <b>Alerts</b> bell at the top lists reminders such as unassigned devices, check-ins and short receipts.</p>' }
  ],
  ADMIN: [
    { title: 'Dashboard', html:
      '<p>Totals by property and status. Tap a property for its detail: workforce, devices, SD cards, issues and flags. The tiles at the top lead to Transfers, Needs attention and Issues. The <b>Office stock</b> tile opens the list of everything held in the Office, whichever admin holds it; tick several to report an issue or send them.</p>' },
    { title: 'Schedule', html:
      '<p>Shows every supervisor\'s current and next property and whether their last location or scan matches it. Tap <b>Why</b> to see exactly what the status was worked out from. Below is the full movement history with a filter by supervisor, and any schedule rows not linked to a supervisor. Ask your manager to correct those rows.</p>' },
    { title: 'Invoices', html:
      '<p><b>Invoices</b> lists what supervisors have sent, with their pictures and PDFs. Filter by status, category, brand, supervisor or date; <b>Download CSV</b> gives the list for accounts. <b>Approve</b> an invoice, or <b>Send back</b> with a reason (the supervisor is asked to send a better one).</p>' +
      '<p><b>Request invoices</b> asks for the invoice of past or present transfers or check-ins (the supervisor on each is asked) or for props bought (pick the supervisors and say what for); set a note and a due date. A request that is late shows in Needs attention. The logistic brand lists (one each for transfers, check-ins and props) are edited in Manage > Options (LOGISTIC_BRAND_TRANSFER, LOGISTIC_BRAND_CHECKIN, LOGISTIC_BRAND_PROPS). The invoice category is hidden; set Settings > INVOICE_SHOW_CATEGORY to Y to bring it back.</p>' },
    { title: 'Transfers', html:
      '<p>Dispatch assets and confirm receipt of anything sent to the Office. The sender cannot confirm their own transfer. Tick only what arrived; the rest is flagged as short.</p>' +
      '<p>At the bottom, <b>Transfer history</b> lists the last 6 closed transfers; pick From and To dates to look further back.</p>' +
      '<p><b>In the Office:</b> what a supervisor sent you appears here after you confirm receipt. For SD cards press <b>Upload process started</b>, then <b>Upload process completed</b>, then <b>Send back</b> (to the same supervisor, or choose another). Tick only the cards that are at the same step; the others stay where they are. <b>Keep in Office</b> takes the ticked items out of the list and they stay in your custody. <b>Step back</b> undoes the last step. Devices have no upload: send them back or keep them.</p>' },
    { title: 'Needs attention', html:
      '<p>Everything the app has flagged. Select several to dismiss, assign a holder, settle a short receipt or acknowledge. A "Not at scheduled property" alert appears at 14:00 for a supervisor who is not at a property starting today, and clears by itself when they arrive.</p>' },
    { title: 'Issues', html:
      '<p>Review reported issues and photos. Select several to resolve at once.</p>' +
      '<p><b>The repair journey.</b> Each faulty device shows its stage: At site, On the way to office, At office, Under review, On the way to product team, With product team, Coming back, Back from product team, Resolved, with how many days it has been there. Use the filters to see one stage. The device you just worked on moves to the top. When a transfer with a faulty device is received, the card asks what next: <b>Under review</b>, <b>Resolve</b>, or <b>Send to product team</b> (with a note and, if you like, the courier and tracking number). The product team confirms receipt and deposits it back; if they forget, press <b>Mark back from product team</b>. Then <b>Confirm receipt</b> and <b>Resolve</b>. Every step keeps its note: tap <b>Show the story</b>. Product-team handovers are listed in Transfer history as read-only cards.</p>' +
      '<p>A device with an open issue is shown as <b>faulty</b> on its transfer, and it does not join the Office batch. When you resolve the issue of a device that came in through the Office, it comes back here under <b>Back from repair</b>: send it back (to the supervisor who reported it, or another) or keep it in the Office. SD cards go through the upload steps first. Tap any asset to see its full issue history.</p>' },
    { title: 'Assets: add and import', html:
      '<p>Add assets one per line, or import many from a CSV file.</p>' +
      '<ol><li>Tap <b>Download CSV template</b> and fill it in. Columns: AssetID, Category (DEVICE or SD_CARD), SubType, Serial, Capacity, HolderEmail.</li>' +
      '<li>Tap <b>Choose CSV file</b>. The app shows how many rows are ready and lists any problems.</li>' +
      '<li>Tap <b>Import</b>. Existing IDs are skipped and listed.</li></ol>' +
      '<p>HolderEmail is optional: blank means you hold it at the Office; a supervisor\'s Gmail puts it with them. An email that is in neither list is skipped.</p>' },
    { title: 'Supervisors', html:
      '<p>See where each supervisor is, their upcoming properties and their attendance history. Upcoming properties come from the property schedule, not from this screen. You can rename a property here; its ID never changes.</p>' +
      '<p>Each supervisor also shows their <b>last location</b> as latitude and longitude (for example 12.345, 77.4356) with <b>Copy</b> and <b>Open in Google Maps</b>, and when it was captured. The same appears under the supervisor you pick when you dispatch, so you know where to send the parcel. It is only as fresh as their last visit to the app with location allowed, or their last attendance scan.</p>' +
      '<p>A red or amber <b>Location may be wrong</b> warning appears (also at the top of the Dashboard) while a location challenge for that supervisor is still open, or was approved less than 3 hours ago. The corrected location is applied at the next recalibration, a quarter past 12, 3, 6 and 9, am and pm. Ask the supervisor before you send a parcel while it shows. It also ends by itself once the supervisor has checked in at a different property than the challenged one.</p>' },
    { title: 'Reports and Refresh settings', html:
      '<p><b>Reports</b> downloads CSV files: inventory, transfers, movements, issues and assignments. <b>Refresh settings</b> reloads the settings straight away if your manager has just changed them.</p>' }
  ],
  OPS: [
    { title: 'Dashboard', html: '<p>Totals by property and status. Tap a property for its detail.</p>' },
    { title: 'Schedule', html: '<p>Every supervisor\'s current and next property, whether they are at it, and the movement history. Tap <b>Why</b> to see how a status was worked out.</p>' },
    { title: 'Needs attention and Issues', html: '<p>Flagged items and reported issues. Select several to act on them together.</p>' },
    { title: 'Reports', html: '<p>Download CSV reports.</p>' }
  ],
  TECH: [
    { title: 'The Tech desk', html: '<p>These are the faulty devices the Office has sent to you for repair. <b>On the way to the product team:</b> press <b>Confirm receipt</b> when a device reaches you. <b>With the product team:</b> when it is ready, press <b>Deposit back after repair</b>, choose what happened (Repaired, Part replaced or Not repairable) and write what was done. The Office then confirms receipt. Tap <b>Show the story</b> to see every step of a device.</p><p>If you forget a step, the Office can mark the device back themselves, and the story will say so.</p>' }
  ],
  MANAGER: [
    { title: 'What Manage is for', html: '<p>Manage lets you change the setup of the app here, so you rarely need to open the spreadsheet. Every change you make is recorded: who, when, what it was and what it became.</p>' },
    { title: 'Health check', html: '<p>The top card lists things worth fixing, in plain words: a supervisor with no location group, a team member with no supervisor, a schedule row that matches nobody. Fix what is red first.</p>' },
    { title: 'Team, supervisors and properties', html: '<ul><li><b>Team:</b> pick the supervisor each person reports to. That decides whose Assign screen they appear on.</li><li><b>Supervisors:</b> add a supervisor, change a name, Gmail or phone, or switch them off.</li><li><b>Properties:</b> set which supervisor works in each location group, and the number of SD cards and devices per worker.</li></ul><p>A supervisor can be in only one location group. Items marked "calculated in the sheet" cannot be edited here.</p>' },
    { title: 'Location challenges', html: '<p>When someone says the property they are at has the wrong map location, the challenge appears in a red card at the very top of Manage. It shows the property that was challenged (found from its Location ID and the date and time of the challenge), the link now and the link they gave. <b>Approve</b> changes the link of that one check-in; <b>Reject</b> closes it without changing anything. Approve is only possible while that check-in is still current: once its day has passed, or if no check-in is found, only Reject is offered. Later check-ins of the same place are not changed.</p>' },
    { title: 'Admins, options, shift times and settings', html: '<ul><li><b>Admins:</b> add or switch off admins, ops and managers. You cannot switch off yourself or the last active admin or manager.</li><li><b>Options:</b> the drop-down lists, such as issue types and what each one does. Hide an option instead of deleting it if you might want it back. To add a new kind of asset, add a row whose List is <b>SUBTYPE_</b> plus a name (for example SUBTYPE_OTHERS) and put a kind in Value: the app then offers that category everywhere assets are added or reported. Add <b>ISSUE_</b> and the same name for its own issue types. New categories are tracked, sent and reported on, but not handed to workers.</li><li><b>Shift times:</b> when each shift\'s assignments end.</li><li><b>Settings:</b> numbers, times and names the app uses. Changes apply within a couple of minutes, or tap Refresh settings.</li></ul>' },
    { title: 'If two managers edit at once', html: '<p>If someone else changed a row while you were editing it, you see "Someone else just changed this". Close the box, look at the new value, and try again. Nothing is overwritten.</p>' },
    { title: 'Property links and the change history', html: '<p>Property links cannot be changed here yet. The change history lists the latest changes by everyone, with the old and new values.</p>' }
  ],
  COMMON: [
    { title: 'Signing in', html:
      '<p>Sign in once with Google; you stay signed in for 14 days on that device. If your Gmail has more than one role, use the <b>Acting as</b> switch at the top. If you see "not in the user list", you are using a Gmail that has not been added. Contact your manager.</p>' },
    { title: 'Messages and what to do', html:
      '<ul><li><b>Please sign in again:</b> your session ended. Sign in again.</li>' +
      '<li><b>Could not reach the server:</b> wait a few seconds and retry. The first load after a quiet period is slower.</li>' +
      '<li><b>Location not detected yet:</b> scan in at your property, then try again.</li>' +
      '<li><b>…is not at your property:</b> the asset is held elsewhere. Ask its holder or an admin to move it.</li>' +
      '<li><b>…is in transit:</b> a transfer for it is still open. Wait for receipt or cancel it.</li>' +
      '<li><b>…is faulty and cannot be assigned:</b> an open issue disables it. Use another device.</li>' +
      '<li><b>…is not on your team and has not scanned in:</b> pick someone from the list, or ask them to scan in. Contact your manager if they should be on your team.</li>' +
      '<li><b>Unresolved short receipt:</b> ask an admin to settle it first.</li>' +
      '<li><b>Photo too large or wrong type:</b> retake a smaller JPEG, PNG or WebP.</li></ul>' },
    { title: 'It says error but may have saved', html:
      '<p>If a save shows an error or times out, it may still have gone through. Reload and check Transfers, Home or Assign before repeating it, so you do not create a duplicate.</p>' },
    { title: 'Things that look wrong but are not', html:
      '<ul><li><b>Home is empty:</b> your location may not be detected yet, or assets are recorded under another holder. Scan in; if it stays empty, contact your manager.</li>' +
      '<li><b>A person is missing in Assign:</b> they are not on your team and have not scanned in at your property today.</li>' +
      '<li><b>Counts look low:</b> only working devices count.</li>' +
      '<li><b>A change by your manager has not appeared:</b> it can take about a minute.</li></ul>' },
    { title: 'Location permission', html:
      '<p>When you open the app your phone may ask to share your location. Please allow it: it is used to tell whether you are at your scheduled property. If you decline, the app falls back to your attendance scan.</p>' }
  ]
};

/** The sections a person should see, in order: their role first, then the common ones. */
function helpSections(role) {
  return (HELP[role] || []).concat(HELP.COMMON);
}

if (typeof module !== 'undefined') module.exports = { HELP: HELP, helpSections: helpSections };
