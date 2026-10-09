// CSV helpers for the admin "Assets" import. Pure functions (no page access) so they can be tested in node.

/** Text of a CSV file -> array of rows (arrays of strings). Handles quotes, doubled quotes, CRLF and a leading BOM. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = String(text === undefined || text === null ? '' : text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
}

function csvQuote(v) {
  v = String(v === undefined || v === null ? '' : v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

const ASSET_CSV_COLUMNS = ['AssetID', 'Category', 'SubType', 'Serial', 'Capacity', 'HolderEmail'];

/** The file admins download, fill in and upload. */
function assetCsvTemplate() {
  return [ASSET_CSV_COLUMNS,
    ['D401', 'DEVICE', 'Android Phone', 'SN12345', '', ''],
    ['SD401', 'SD_CARD', '128GB', '', '128GB', 'supervisor@gmail.com']
  ].map(function (r) { return r.map(csvQuote).join(','); }).join('\r\n') + '\r\n';
}

const ASSET_CSV_ALIASES = {
  AssetID: ['assetid', 'asset id', 'asset', 'id', 'asset_id'],
  Category: ['category', 'type', 'asset type', 'kind of asset'],
  SubType: ['subtype', 'sub type', 'sub_type', 'kind', 'model'],
  Serial: ['serial', 'serial number', 'serial no', 'serial_no', 'sn'],
  Capacity: ['capacity', 'size', 'storage'],
  HolderEmail: ['holderemail', 'holder email', 'holder', 'email', 'holder_email', 'gmail']
};

/**
 * Parsed CSV rows -> { rows: [{AssetID, Category, SubType, Serial, Capacity, HolderEmail}], problems: [text], headerOk }.
 * Columns are found by their header NAME (any order; common spellings accepted). Rows with problems the server would
 * reject anyway (no id, bad category, id repeated inside the file) are listed in `problems` and left out of `rows`.
 */
function assetRowsFromCsv(parsed) {
  const out = { rows: [], problems: [], headerOk: false };
  if (!parsed.length) { out.problems.push('The file is empty.'); return out; }
  const head = parsed[0].map(function (h) { return String(h).trim().toLowerCase().replace(/\s+/g, ' '); });
  const idx = {};
  Object.keys(ASSET_CSV_ALIASES).forEach(function (k) {
    for (let i = 0; i < head.length; i++) { if (ASSET_CSV_ALIASES[k].indexOf(head[i]) !== -1) { idx[k] = i; break; } }
  });
  if (idx.AssetID === undefined || idx.Category === undefined) {
    out.problems.push('The first row must be the column names, including AssetID and Category. Download the template to see the format.');
    return out;
  }
  out.headerOk = true;
  const seen = {};
  for (let r = 1; r < parsed.length; r++) {
    const get = function (k) { return idx[k] === undefined ? '' : String(parsed[r][idx[k]] === undefined ? '' : parsed[r][idx[k]]).trim(); };
    const row = { AssetID: get('AssetID'), Category: get('Category'), SubType: get('SubType'), Serial: get('Serial'), Capacity: get('Capacity'), HolderEmail: get('HolderEmail') };
    const line = 'Line ' + (r + 1) + ': ';
    const cat = row.Category.toUpperCase().replace(/[\s-]+/g, '_');
    if (!row.AssetID) { out.problems.push(line + 'no AssetID.'); continue; }
    if (cat !== 'DEVICE' && cat !== 'SD_CARD') { out.problems.push(line + row.AssetID + ': Category must be DEVICE or SD_CARD.'); continue; }
    if (seen[row.AssetID]) { out.problems.push(line + row.AssetID + ' appears more than once in the file.'); continue; }
    seen[row.AssetID] = true;
    row.Category = cat;
    out.rows.push(row);
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { parseCsv: parseCsv, csvQuote: csvQuote, assetCsvTemplate: assetCsvTemplate, assetRowsFromCsv: assetRowsFromCsv };
