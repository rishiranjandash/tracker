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
      '<p>Below it, Home lists the assets at your property. Tap a device for its menu. Tick several to report an issue, send or assign them together.</p>' },
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
    { title: 'Send assets and confirm receipt', html:
      '<ol><li>Open <b>Transfers</b> and choose where to send: the Office or another supervisor.</li><li>Tick the assets and send.</li></ol>' +
      '<p>The receiver ticks only what actually arrived. Anything not ticked is flagged as a short receipt for an admin to settle. You can cancel a transfer that is still in transit. You cannot confirm a transfer you sent yourself.</p>' },
    { title: 'Report an issue', html:
      '<p>Open <b>Report issue</b>, select one or many assets, choose the issue type for each, add a photo if it helps, and submit. Faulty devices stop counting as working and cannot be assigned until an admin resolves the issue.</p>' },
    { title: 'Asset check-in', html:
      '<p>When your property changes (from 12:00 on the day a new property starts) you get a task to list the assets you hold, one a day. Tick what you physically have. Missing items are flagged for an admin to follow up. You can keep working while it is open.</p>' },
    { title: 'Search and alerts', html:
      '<p><b>Search</b> finds any asset by ID and shows its full history. The <b>Alerts</b> bell at the top lists reminders such as unassigned devices, check-ins and short receipts.</p>' }
  ],
  ADMIN: [
    { title: 'Dashboard', html:
      '<p>Totals by property and status. Tap a property for its detail: workforce, devices, SD cards, issues and flags. The tiles at the top lead to Transfers, Needs attention and Issues.</p>' },
    { title: 'Schedule', html:
      '<p>Shows every supervisor\'s current and next property and whether their last location or scan matches it. Tap <b>Why</b> to see exactly what the status was worked out from. Below is the full movement history with a filter by supervisor, and any schedule rows not linked to a supervisor. Ask your manager to correct those rows.</p>' },
    { title: 'Transfers', html:
      '<p>Dispatch assets and confirm receipt of anything sent to the Office. The sender cannot confirm their own transfer. Tick only what arrived; the rest is flagged as short.</p>' },
    { title: 'Needs attention', html:
      '<p>Everything the app has flagged. Select several to dismiss, assign a holder, settle a short receipt or acknowledge. A "Not at scheduled property" alert appears at 14:00 for a supervisor who is not at a property starting today, and clears by itself when they arrive.</p>' },
    { title: 'Issues', html:
      '<p>Review reported issues and photos. Select several to resolve at once.</p>' },
    { title: 'Assets: add and import', html:
      '<p>Add assets one per line, or import many from a CSV file.</p>' +
      '<ol><li>Tap <b>Download CSV template</b> and fill it in. Columns: AssetID, Category (DEVICE or SD_CARD), SubType, Serial, Capacity, HolderEmail.</li>' +
      '<li>Tap <b>Choose CSV file</b>. The app shows how many rows are ready and lists any problems.</li>' +
      '<li>Tap <b>Import</b>. Existing IDs are skipped and listed.</li></ol>' +
      '<p>HolderEmail is optional: blank means you hold it at the Office; a supervisor\'s Gmail puts it with them. An email that is in neither list is skipped.</p>' },
    { title: 'Supervisors', html:
      '<p>See where each supervisor is, their upcoming properties and their attendance history. Upcoming properties come from the property schedule, not from this screen. You can rename a property here; its ID never changes.</p>' },
    { title: 'Reports and Refresh settings', html:
      '<p><b>Reports</b> downloads CSV files: inventory, transfers, movements, issues and assignments. <b>Refresh settings</b> reloads the settings straight away if your manager has just changed them.</p>' }
  ],
  OPS: [
    { title: 'Dashboard', html: '<p>Totals by property and status. Tap a property for its detail.</p>' },
    { title: 'Schedule', html: '<p>Every supervisor\'s current and next property, whether they are at it, and the movement history. Tap <b>Why</b> to see how a status was worked out.</p>' },
    { title: 'Needs attention and Issues', html: '<p>Flagged items and reported issues. Select several to act on them together.</p>' },
    { title: 'Reports', html: '<p>Download CSV reports.</p>' }
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
