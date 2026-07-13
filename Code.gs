// =============================================
//  EE Lab Inventory — Code.gs
// =============================================

var INVENTORY_SHEET = "Inventory";
var REQUESTS_SHEET  = "Requests";

// Inventory columns:
// A: Item Name | B: Category | C: Quantity | D: Assigned Icon | E: Item Type | F: Price

// Requests columns:
// A: Name | B: Section | C: Type | D: Timestamp | E: Materials | F: Reason | G: Status

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
      var rowNum   = parseInt(params.row, 10);
      var newStatus = params.status || '';
      var result   = updateRequestStatus(rowNum, newStatus);
      return jsonOut(result);
    }

    if (action === 'requests') return jsonOut(getRequestsData());
    return jsonOut(getInventoryData());

  } catch (err) {
    return jsonOut({ error: err.message });
  }
}

// =============================================
//  doPost — new form submissions
// =============================================
function doPost(e) {
  try {
    var p        = e.parameter;
    var name     = p.name     || '';
    var section  = p.section  || '';
    var type     = p.type     || '';
    var item     = p.item     || '';
    var quantity = p.quantity || '1';
    var reason   = p.reason   || '';

    var materials = item + (quantity && quantity !== '1' ? ' (x' + quantity + ')' : '');

    var status;
    if (type === 'Borrow')      status = 'Reserved';
    else if (type === 'Buy')    status = 'Pending';
    else                        status = 'Acknowledged';

    var now = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd HH:mm:ss');

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(REQUESTS_SHEET);

    if (!sheet) {
      sheet = ss.insertSheet(REQUESTS_SHEET);
      sheet.appendRow(['Name','Course / Year Level / Section',
                       'Type of Transaction','Time of Transaction',
                       'Materials','Reason','Status']);
    }

    // 7 columns: A-G
    sheet.appendRow([name, section, type, now, materials, reason, status]);

    // --- Deduct inventory immediately on creation ---
    // Borrow  -> deducted as soon as it's Reserved
    // Buy     -> deducted as soon as it's Pending
    // Request New -> item isn't in inventory yet, nothing to deduct
    if (type === 'Borrow' || type === 'Buy') {
      adjustInventoryQty(item, -Math.abs(Number(quantity) || 1));
    }

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
    var invSheet = ss.getSheetByName(INVENTORY_SHEET);

    if (!reqSheet) throw new Error('Requests sheet not found.');

    var row       = reqSheet.getRange(rowNumber, 1, 1, 7).getValues()[0];
    var type      = row[2]; // C: Type
    var materials = row[4]; // E: Materials
    var oldStatus = row[6]; // G: current Status (before this update)

    // Write new status to G
    reqSheet.getRange(rowNumber, 7).setValue(newStatus);

    // Don't double-fire inventory adjustments if the status isn't actually changing
    if (oldStatus === newStatus) {
      return { success: true };
    }

    // --- Auto Inventory Update ---
    // Deduction already happens once at creation time (doPost):
    //   Borrow -> Reserved, Buy -> Pending
    // From here, status moves are just tracking, EXCEPT:
    //   Borrow -> Returned  : adds the deducted quantity back
    //   Buy    -> Purchased : already deducted, no further change
    if (invSheet && type === 'Borrow') {
      var itemName = materials.replace(/\s*\(x\d+\)\s*$/, '').trim();
      var qtyMatch = materials.match(/\(x(\d+)\)/);
      var qty      = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

      if (newStatus === 'Returned') {
        // Item came back -> add stock back
        adjustInventoryQty(itemName, qty);
      } else if (oldStatus === 'Returned') {
        // Admin corrected a mistaken "Returned" back to Reserved/Not Returned
        // -> re-deduct so inventory stays accurate
        adjustInventoryQty(itemName, -qty);
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
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
      var invRow      = i + 1;
      var currentQty  = Number(invSheet.getRange(invRow, 3).getValue()) || 0;
      var newQty      = Math.max(0, currentQty + deltaQty);
      invSheet.getRange(invRow, 3).setValue(newQty);
      return true;
    }
  }
  return false;
}

// =============================================
//  getRequestsData — shared by sidebar + doGet
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
    result.push({
      rowNumber : i + 1,
      name      : row[0] || '',
      section   : row[1] || '',
      type      : row[2] || '',
      timestamp : row[3] ? String(row[3]) : '',
      materials : row[4] || '',
      reason    : row[5] || '',
      status    : row[6] || '',
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
