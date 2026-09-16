// =============================================
//  EE Lab Inventory — Code.gs 1BBB
// =============================================

var INVENTORY_SHEET = "Inventory";
var REQUESTS_SHEET  = "Requests";
var REVIEWS_SHEET   = "Reviews";

// Inventory columns:
// A: Item Name | B: Category | C: Quantity | D: Assigned Icon | E: Item Type | F: Price

// Requests columns:
// A: Name | B: Section | C: Type | D: Timestamp | E: Materials (item name)
// F: Quantity | G: Reason | H: Status | I: Total Price (Buy only, locked at request time)

// Reviews columns:
// A: Timestamp | B: Stars | C: Name (optional) | D: Comment (optional)

// =============================================
//  Custom Menu
// =============================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('⚡ EE Lab Admin')
    .addItem('Open Admin Panel', 'openAdminSidebar')
    .addToUi();
}

function openAdminSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('AdminSidebar')
    .setTitle('EE Lab Admin Panel')
    .setWidth(480);
  SpreadsheetApp.getUi().showSidebar(html);
}

// =============================================
//  doGet — inventory, requests, or status update
// =============================================
function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var action = params.action || 'inventory';

  try {
    // Status update via GET to avoid CORS issues with POST
    if (action === 'updateStatus') {
      var rowNum    = parseInt(params.row, 10);
      var newStatus = params.status || '';
      var result    = updateRequestStatus(rowNum, newStatus);
      return jsonOut(result);
    }

    if (action === 'requests')    return jsonOut(getRequestsData());
    if (action === 'reviewStats') return jsonOut(getReviewStats());
    return jsonOut(getInventoryData());

  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

// =============================================
//  doPost — new form submissions
//  Two independent kinds of submission share this one endpoint:
//    formType=review  -> handleReviewSubmission() (Reviews sheet)
//    anything else     -> the item request flow below (Requests sheet)
//  The review branch returns immediately so a review never falls through
//  into the request-append code (that was the bug: reviews were landing
//  in Requests as a bogus row, and their star/comment values were being
//  silently dropped since the request path never reads those params).
// =============================================
function doPost(e) {
  try {
    var p = e.parameter;

    if (p.formType === 'review') {
      return jsonOut(handleReviewSubmission(p));
    }

    var name     = p.name     || '';
    var section  = p.section  || '';
    var type     = p.type     || '';
    var item     = p.item     || '';
    var quantity = p.quantity || '1';
    var reason   = p.reason   || '';

    var qtyNum = Math.abs(Number(quantity)) || 1;

    var status;
    if (type === 'Borrow')      status = 'Reserved';
    else if (type === 'Buy')    status = 'Pending';
    else                        status = 'Acknowledged';

    // --- Stock check BEFORE anything is written ---
    if (type === 'Borrow' || type === 'Buy') {
      var available = getInventoryQty(item);
      if (available === null) {
        return jsonOut({ success: false, error: 'Item "' + item + '" was not found in inventory.' });
      }
      if (qtyNum > available) {
        return jsonOut({ success: false, error: 'Only ' + available + ' unit(s) of "' + item + '" left in stock.' });
      }
    }

    // --- Total Price (column I) ---
    // Only Buy requests generate income; Borrow/Request New leave this blank.
    // Locked in at the moment of request using the item's CURRENT Inventory
    // price, so later price changes never rewrite what a past log says was
    // charged.
    var totalPrice = '';
    if (type === 'Buy') {
      var priceEach = getInventoryPrice(item);
      if (priceEach !== null) totalPrice = priceEach * qtyNum;
    }

    var now = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm:ss');

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(REQUESTS_SHEET);

    if (!sheet) {
      sheet = ss.insertSheet(REQUESTS_SHEET);
      sheet.appendRow(['Name','Course / Year Level / Section',
                       'Type of Transaction','Time of Transaction',
                       'Materials','Quantity','Reason','Status','Total Price']);
    }

    // 9 columns: A-I
    sheet.appendRow([name, section, type, now, item, qtyNum, reason, status, totalPrice]);

    // --- Nothing is deducted at creation anymore ---
    // Borrow -> deducted only when status is manually set to "Not Returned"
    // Buy    -> deducted only when status is manually set to "Purchased"
    // Both of those happen via the onEdit trigger below, not here — doPost's
    // writes to the Inventory sheet were unreliable (see applyInventoryEffect).

    return jsonOut({ success: true });
  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  }
}

// =============================================
//  updateRequestStatus
//  Called from sidebar via google.script.run
//  AND from doGet?action=updateStatus
// =============================================
function updateRequestStatus(rowNumber, newStatus) {
  try {
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var reqSheet = ss.getSheetByName(REQUESTS_SHEET);

    if (!reqSheet) throw new Error('Requests sheet not found.');

    var row       = reqSheet.getRange(rowNumber, 1, 1, 8).getValues()[0];
    var type      = String(row[2] || '').trim(); // C: Type
    var itemName  = String(row[4] || '').trim(); // E: Materials (item name)
    var qty       = Number(row[5]) || 1;         // F: Quantity
    var oldStatus = String(row[7] || '').trim(); // H: current Status (before this update)
    newStatus     = String(newStatus || '').trim();

    // Write new status to H
    reqSheet.getRange(rowNumber, 8).setValue(newStatus);

    // Don't double-fire inventory adjustments if the status isn't actually changing
    if (oldStatus === newStatus) {
      return { success: true };
    }

    applyInventoryEffect(type, itemName, qty, oldStatus, newStatus);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// =============================================
//  onEdit — SIMPLE TRIGGER, fires automatically whenever
//  a human edits a cell directly in the spreadsheet.
//  Detects manual edits to the Status column (H) on the
//  Requests sheet and applies the same inventory logic
//  that updateRequestStatus() applies for sidebar/API calls.
//
//  NOTE: this only fires for single-cell edits (typing a
//  value into one cell and hitting Enter/Tab). Pasting a
//  block of cells or dragging to fill multiple rows at once
//  does NOT populate e.oldValue/e.value reliably, so those
//  edits are silently skipped — change one cell at a time,
//  or use the Admin Sidebar instead.
// =============================================
function onEdit(e) {
  try {
    if (!e || !e.range) return;

    var sheet = e.range.getSheet();
    if (sheet.getName() !== REQUESTS_SHEET) return;

    // Status lives in column H (8); ignore edits elsewhere
    if (e.range.getColumn() !== 8 || e.range.getNumColumns() !== 1) return;

    var rowNumber = e.range.getRow();
    if (rowNumber === 1) return; // header row
    if (e.range.getNumRows() !== 1) return; // ignore multi-row paste/fill

    var oldStatus = String(e.oldValue || '').trim();
    var newStatus = String(e.value || '').trim();
    if (!newStatus || oldStatus === newStatus) return;

    var row      = sheet.getRange(rowNumber, 1, 1, 8).getValues()[0];
    var type     = String(row[2] || '').trim(); // C: Type
    var itemName = String(row[4] || '').trim(); // E: Materials (item name)
    var qty      = Number(row[5]) || 1;         // F: Quantity

    applyInventoryEffect(type, itemName, qty, oldStatus, newStatus);

  } catch (err) {
    // Simple triggers run silently — log so it shows up in
    // Apps Script > Executions if something goes wrong.
    console.error('onEdit error:', err);
  }
}

// =============================================
//  applyInventoryEffect — shared by updateRequestStatus()
//  (sidebar/API path) and onEdit() (manual sheet edit path)
//
//  Nothing is deducted at creation. Instead, each type has one
//  status that represents "the item has physically left the lab":
//    Borrow -> "Not Returned"   (Reserved has no inventory effect)
//    Buy    -> "Purchased"
//
//  State-based, not transition-based: we compare whether the
//  item was "out" before vs. after this edit, so it behaves
//  correctly no matter which status the request jumps from/to
//  (e.g. Reserved -> Returned directly, skipping Not Returned,
//  correctly results in NO inventory change either way).
// =============================================
function applyInventoryEffect(type, itemName, qty, oldStatus, newStatus) {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var invSheet = ss.getSheetByName(INVENTORY_SHEET);
  if (!invSheet || !(type === 'Borrow' || type === 'Buy') || !itemName) return;

  qty = Number(qty) || 1;

  var outStatus = (type === 'Borrow') ? 'Not Returned' : 'Purchased';
  var wasOut    = (oldStatus === outStatus);
  var isOut     = (newStatus === outStatus);

  if (!wasOut && isOut) {
    adjustInventoryQty(itemName, -qty); // item just left the lab / was purchased
  } else if (wasOut && !isOut) {
    adjustInventoryQty(itemName, qty);  // item came back / status corrected
  }
}

// =============================================
//  adjustInventoryQty — add (positive) or deduct (negative)
//  from an item's quantity column. Clamped at 0.
//  Returns true if the item was found and updated.
// =============================================
function adjustInventoryQty(itemName, deltaQty) {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var invSheet = ss.getSheetByName(INVENTORY_SHEET);
  if (!invSheet || !itemName) return false;

  var cleanName = String(itemName).trim().toLowerCase();
  var invData   = invSheet.getDataRange().getValues();

  for (var i = 1; i < invData.length; i++) {
    if (String(invData[i][0]).trim().toLowerCase() === cleanName) {
      var invRow     = i + 1;
      var currentQty = Number(invSheet.getRange(invRow, 3).getValue()) || 0;
      var newQty     = Math.max(0, currentQty + deltaQty);
      invSheet.getRange(invRow, 3).setValue(newQty);
      return true;
    }
  }
  return false;
}

// =============================================
//  getInventoryQty — current quantity for an item.
//  Returns null if the item isn't found in Inventory.
// =============================================
function getInventoryQty(itemName) {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var invSheet = ss.getSheetByName(INVENTORY_SHEET);
  if (!invSheet || !itemName) return null;

  var cleanName = String(itemName).trim().toLowerCase();
  var invData   = invSheet.getDataRange().getValues();

  for (var i = 1; i < invData.length; i++) {
    if (String(invData[i][0]).trim().toLowerCase() === cleanName) {
      return Number(invData[i][2]) || 0;
    }
  }
  return null;
}

// =============================================
//  getInventoryPrice — current unit price for an item.
//  Returns null if the item isn't found, or has no price set
//  (blank Price cell — e.g. a Lendable item).
// =============================================
function getInventoryPrice(itemName) {
  var ss       = SpreadsheetApp.getActiveSpreadsheet();
  var invSheet = ss.getSheetByName(INVENTORY_SHEET);
  if (!invSheet || !itemName) return null;

  var cleanName = String(itemName).trim().toLowerCase();
  var invData   = invSheet.getDataRange().getValues();

  for (var i = 1; i < invData.length; i++) {
    if (String(invData[i][0]).trim().toLowerCase() === cleanName) {
      var raw = invData[i][5]; // column F: Price
      return (raw !== '' && raw !== undefined && raw !== null) ? Number(raw) : null;
    }
  }
  return null;
}

// =============================================
//  handleReviewSubmission — writes one row to the Reviews sheet.
//  Called only from doPost when formType=review. Name and Comment are
//  optional (the front end sends '' when left blank); Stars is required
//  by the front end's own validation, but we still guard here in case
//  of a malformed call.
// =============================================
function handleReviewSubmission(p) {
  try {
    var stars   = Number(p.stars) || 0;
    var name    = p.name    || '';
    var comment = p.comment || '';

    if (stars < 1 || stars > 5) {
      return { success: false, error: 'Invalid star rating.' };
    }

    var now = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm:ss');

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(REVIEWS_SHEET);

    if (!sheet) {
      sheet = ss.insertSheet(REVIEWS_SHEET);
      sheet.appendRow(['Timestamp', 'Stars', 'Name', 'Comment']);
    }

    sheet.appendRow([now, stars, name, comment]);

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// =============================================
//  getReviewStats — average Stars + count, for the footer rating strip.
// =============================================
function getReviewStats() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REVIEWS_SHEET);
  if (!sheet) return { average: 0, count: 0 };

  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { average: 0, count: 0 };

  var total = 0;
  var count = 0;
  for (var i = 1; i < rows.length; i++) {
    var stars = Number(rows[i][1]);
    if (!stars) continue; // skip blank/malformed rows rather than let them drag the average down
    total += stars;
    count++;
  }

  return {
    average: count > 0 ? (total / count) : 0,
    count: count,
  };
}

// =============================================
//  getRequestsData — shared by sidebar + doGet
//  Re-embeds "(xN)" into the materials string for display,
//  so the existing logs.js front end (which just prints
//  row.materials as-is) keeps showing quantity correctly.
// =============================================
function getRequestsData() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REQUESTS_SHEET);
  if (!sheet) return [];

  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];

  var result = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0] && !row[2]) continue;

    var itemName = row[4] || '';
    var qty      = Number(row[5]) || 1;
    var materialsDisplay = itemName + (qty !== 1 ? ' (x' + qty + ')' : '');

    var rawPrice = row[8];
    var totalPrice = (rawPrice !== '' && rawPrice !== undefined && rawPrice !== null)
                       ? Number(rawPrice) : null;

    result.push({
      rowNumber : i + 1,
      name      : row[0] || '',
      section   : row[1] || '',
      type      : row[2] || '',
      timestamp : row[3] ? String(row[3]) : '',
      materials : materialsDisplay,
      quantity  : qty,
      reason    : row[6] || '',
      status    : row[7] || '',
      totalPrice: totalPrice,
    });
  }
  return result.reverse();
}

// =============================================
//  getInventoryData
// =============================================
function getInventoryData() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(INVENTORY_SHEET);
  if (!sheet) throw new Error('Inventory sheet not found.');

  var rows   = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[0]) continue;
    result.push({
      itemName : row[0] || '',
      category : row[1] || '',
      quantity : Number(row[2]) || 0,
      iconUrl  : String(row[3] || "").trim(),
      itemType : String(row[4] || 'Lendable').trim(),
      price    : (row[5] !== '' && row[5] !== undefined && row[5] !== null)
                   ? Number(row[5]) : null,
    });
  }
  return result;
}

// =============================================
//  Helper
// =============================================
function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}