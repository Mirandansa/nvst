// ============================================================
// StockAnalysis -> Upk
//
// Required Upk headers:
//
//   tickers
//   date_last
//   SA_nly
//   SA_frc
//   SA_icm
//   SA_bal
//   SA_flo
//   SA_kpi
//
// Each SA_* cell contains:
//
//   {
//     "date_fetched": "...ISO timestamp...",
//     "data": {...}
//   }
//
// Refresh condition (see _needsRefresh_ in Utils.gs):
//
//   date_last is empty -> never refresh (date_next hasn't been established)
//   target is empty
//   OR
//   date_last > target.date_fetched
//
// Refresh outcomes are handled by driver-specific policies; they are not uniform.

// ============================================================

var SA_SHEET_NAME = "Upk";

var SA_TICKERS_HEADER = "tickers";

var SA_DATE_LAST_HEADER = "date_last";

var SA_JDG_HEADER = "Jdg";

var SA_HEADERS = {
  Nly: "SA_nly",
  Frc: "SA_frc",
  Icm: "SA_icm",
  Bal: "SA_bal",
  Flo: "SA_flo",
  Kpi: "SA_kpi"
};

var SA_DOM = "https://stockanalysis.com";

var SA_TIME_BUDGET_MS = 5 * 60 * 1000; // stop with margin before the 6-min hard cap

var SA_FLUSH_EVERY = 20;               // write partial progress periodically

var SA_BASE_SLEEP_MS = 800;   // stockanalysis.com tolerates this less than you'd hope

var SA_BACKOFF_MS = 15000;    // pause when a block is detected, then resume

var SA_MAX_ROWS_PER_RUN = 200; // stay comfortably under the 6-min execution cap

// ============================================================
// STOCKANALYSIS URL / FETCH ADAPTER

// ============================================================

function _saUrl_(ide, ctg) {
  var parts = String(ide).split("-");
  if (parts.length !== 2) throw new Error('Invalid ticker identifier: "' + ide + '"');
  var rgn = parts[0];
  var tkr = parts[1];
  if (rgn === "jp") return SA_DOM + "/quote/tyo/" + tkr + "/" + ctg + "/";
  return SA_DOM + "/stocks/" + tkr + "/" + ctg;
}

function _saIsBlocked_(html) {
  return /Just a moment|cf-browser-verification|Attention Required.*Cloudflare|cf-chl-bypass/i.test(html);
}

function _saHtmlOf_(ide, ctg) {
  return ScrapeCore.fetchHtml(_saUrl_(ide, ctg), {
    blockDetector: _saIsBlocked_,
    userAgent: "Mozilla/5.0",
    logPrefix: "StockAnalysis"
  });
}

var SA_PLACEHOLDERS = {
  "": true,
  "-": true,
  "n/a": true,
  "N/A": true,
  "Pro": true,
  "Upgrade": true
};

function _saCleanCell_(text) {
  return ScrapeCore.cleanCell(text, SA_PLACEHOLDERS, "¥$€");
}
// TABLE PARSER

// ============================================================

function _saTableToDict_(table) {
  var rows = ScrapeCore.elements(ScrapeCore.innerHtml(table, "table"), "tr");
  var periods = null;
  var result = {};
  for (var i = 0; i < rows.length; i++) {
    var cells = ScrapeCore.cells(rows[i]);
    if (!cells.length) {
      continue;
    }
    var allTh = cells.every(function (c) {
      return c.name === "th";
    });
    // First all-TH row = header.
    if (allTh) {
      if (periods === null) {
        periods = [];
        for (var j = 1; j < cells.length; j++) {
          var id = ScrapeCore.attr(cells[j].tag, "id");
          var period = id ||
            ScrapeCore.text(cells[j].inner);
          periods.push(period);
          result[period] = {};
        }
      }
      // Secondary header rows are ignored.
      continue;
    }
    if (periods === null) {
      continue;
    }
    var labelCell = cells[0];
    var metricKey = _saIconId_(labelCell.inner) || ScrapeCore.text(labelCell.inner);
    for (
      var p = 0;
      p < periods.length && p + 1 < cells.length;
      p++
    ) {
      var value = _saCleanCell_(
        ScrapeCore.text(cells[p + 1].inner)
      );
      if (value === null) {
        continue;
      }
      result[periods[p]][metricKey] = value;
    }
  }
  return result;
}

// ============================================================
// MAIN TABLE

// ============================================================

function _saMainTable_(html, tableId) {
  tableId = tableId || "main-table";
  var tables = ScrapeCore.elements(html, "table");
  for (var i = 0; i < tables.length; i++) {
    var tag = ScrapeCore.openingTag(tables[i], "table");
    var id = ScrapeCore.attr(tag, "id");
    if (id === tableId) {
      return tables[i];
    }
  }
  return null;
}

// ============================================================
// GROUP 1: FINANCIAL STATEMENTS

// ============================================================

function _saMergeMainTables_(html) {
  var tables = ScrapeCore.elements(html, "table");
  var merged = {};
  for (var i = 0; i < tables.length; i++) {
    var tag = ScrapeCore.openingTag(tables[i], "table");
    var id = ScrapeCore.attr(tag, "id");
    if (!id || id.indexOf("main-table") !== 0) continue;
    var d = _saTableToDict_(tables[i]);
    Object.keys(d).forEach(function (period) {
      if (!merged[period]) merged[period] = {};
      Object.assign(merged[period], d[period]);
    });
  }
  return merged;
}

function _saStatement_(ide, ctg) {
  var html = _saHtmlOf_(ide, ctg);
  if (html === ScrapeCore.NOT_FOUND) return ScrapeCore.NOT_FOUND;
  if (!html) return null;
  var merged = _saMergeMainTables_(html);
  if (Object.keys(merged).length === 0) {
    Logger.log('main-table(s) not found for "' + ide + '" / "' + ctg + '"');
    return null;
  }
  return merged;
}

function SA_Icm(ide) {
  return _saStatement_(ide, "financials/income-statement");
}

function SA_Bal(ide) {
  return _saStatement_(ide, "financials/balance-sheet");
}

function SA_Flo(ide) {
  var html = _saHtmlOf_(ide, "financials/cash-flow-statement");
  if (html === ScrapeCore.NOT_FOUND) return ScrapeCore.NOT_FOUND;
  if (!html) return null;
  var tables = ScrapeCore.elements(html, "table");
  var result = {};
  for (var i = 0; i < tables.length; i++) {
    var tag = ScrapeCore.openingTag(tables[i], "table");
    var id = ScrapeCore.attr(tag, "id");
    if (!id || id.indexOf("main-table-") !== 0) continue;
    var key = id.substring("main-table-".length).replace(/-/g, "_");
    result[key] = _saTableToDict_(tables[i]);
  }
  if (Object.keys(result).length === 0) return null;
  return result;
}

function SA_Kpi(ide) {
  var html = _saHtmlOf_(ide, "financials/metrics");
  if (!html) {
    return null;
  }
  var tables = ScrapeCore.elements(html, "table");
  var result = {};
  for (var i = 0; i < tables.length; i++) {
    var tag = ScrapeCore.openingTag(tables[i], "table");
    var id = ScrapeCore.attr(tag, "id");
    if (!id || id.indexOf("main-table-") !== 0) {
      continue;
    }
    var key = id.substring("main-table-".length)
      .replace(/ /g, "_");
    result[key] = _saTableToDict_(tables[i]);
  }
  return result;
}

// ============================================================
// GROUP 2: ANALYST RATINGS

// ============================================================
// Scans opening <div>/<span> tags in a label cell (in document order) for
// the first one with class="icon" (exact token) AND an id attr. Avoids the
// nested-div problem of ScrapeCore.elements (it never captures element bodies,
// just opening tags), and ScrapeCore.hasClass's exact-token match correctly skips
// "icon-inner" (the SVG wrapper nested inside the real icon div).

function _saIconId_(cellHtml) {
  var re = /<(?:div|span)\b[^>]*>/gi;
  var m;
  while ((m = re.exec(cellHtml)) !== null) {
    if (ScrapeCore.hasClass(m[0], "icon") && ScrapeCore.attr(m[0], "id")) {
      return ScrapeCore.attr(m[0], "id");
    }
  }
  return null;
}

function _saParseRatingsTable_(table) {
  var records = {};
  var result = [];
  var rows = ScrapeCore.elements(
    ScrapeCore.innerHtml(table, "table"),
    "tr"
  );
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var nameDiv = ScrapeCore.findByClass(
      row,
      "div",
      "analyst-name"
    );
    if (!nameDiv) {
      continue;
    }
    var cells = ScrapeCore.cells(row);
    var desktopCells = cells.filter(function (c) {
      return ScrapeCore.hasClass(c.tag, "desktop-only");
    });
    if (desktopCells.length < 5) {
      continue;
    }
    var firm = ScrapeCore.text(desktopCells[0].inner);
    var rating = ScrapeCore.text(desktopCells[1].inner);
    var action = ScrapeCore.text(desktopCells[2].inner);
    var priceTarget = ScrapeCore.text(desktopCells[3].inner);
    var upside = ScrapeCore.text(desktopCells[4].inner);
    var date = cells.length
      ? ScrapeCore.text(cells[cells.length - 1].inner)
      : "";
    result.push({
      analyst: ScrapeCore.text(
        ScrapeCore.innerHtml(nameDiv, "div")
      ),
      firm: firm,
      rating: rating,
      action: action,
      price_target: _saCleanCell_(priceTarget),
      upside: _saCleanCell_(upside),
      date: date
    });
  }
  return result;
}

function SA_Nly(ide) {
  var html = _saHtmlOf_(ide, "ratings");
  if (!html) {
    return null;
  }
  var tables = ScrapeCore.elements(html, "table");
  var table = null;
  for (var i = 0; i < tables.length; i++) {
    if (ScrapeCore.hasClass(
      ScrapeCore.openingTag(tables[i], "table"),
      "rating-table"
    )) {
      table = tables[i];
      break;
    }
  }
  return {
    ratings: table
      ? _saParseRatingsTable_(table)
      : []
  };
}

// ============================================================
// FORECAST

// ============================================================

var SA_MONTHS = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12"
};

function _saNormalizeMonthPeriod_(d) {
  var out = {};
  Object.keys(d).forEach(function (period) {
    var m = period.match(/^(\w{3}) '(\d{2})$/);
    if (m && SA_MONTHS[m[1]]) {
      period =
        "20" + m[2] +
        " " + SA_MONTHS[m[1]];
    }
    out[period] = d[period];
  });
  return out;
}

function _saTablesByHeading_(html) {
  var mapping = {};
  var current = null;
  var re = /<(h2|table)[^>]*>[\s\S]*?<\/>/gi;
  var match;
  while ((match = re.exec(html)) !== null) {
    var element = match[0];
    var type = match[1].toLowerCase();
    if (type === "h2") {
      current = ScrapeCore.text(ScrapeCore.innerHtml(element, "h2"));
    } else if (current !== null && !(current in mapping)) {
      mapping[current] = element;
    }
  }
  return mapping;
}

function SA_Frc(ide) {
  var html = _saHtmlOf_(ide, "forecast");
  if (!html) {
    return null;
  }
  if (ScrapeCore.elements(html, "h2").length === 0) {
    return null;
  }
  var tables = _saTablesByHeading_(html);
  var sections = [
    ["price_target", "Price Target"],
    ["recommendation_trends", "Recommendation Trends"],
    ["financial_forecast", "Financial Forecast"],
    ["revenue_forecast", "Revenue Forecast"],
    ["revenue_growth_forecast", "Revenue Growth"],
    ["eps_forecast", "EPS Forecast"],
    ["eps_growth_forecast", "EPS Growth"]
  ];
  var result = {};
  sections.forEach(function (section) {
    var key = section[0];
    var heading = section[1];
    if (tables[heading]) {
      result[key] = _saTableToDict_(tables[heading]);
    }
  });
  if (result.recommendation_trends) {
    result.recommendation_trends =
      _saNormalizeMonthPeriod_(
        result.recommendation_trends
      );
  }
  return result;
}

// ============================================================
// FUNCTION DISPATCH

// ============================================================

var SA_FUNCTIONS = {
  Nly: SA_Nly,
  Frc: SA_Frc,
  Icm: SA_Icm,
  Bal: SA_Bal,
  Flo: SA_Flo,
  Kpi: SA_Kpi
};

// ============================================================

function _saJdgNonEmpty_(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}
// DATE / TARGET STATE

// ============================================================
// Refresh-due check: see _needsRefresh_ in Utils.gs (shared across all
// non-TV_scn fetchers). date_last is empty -> never refresh; target cell
// empty -> refresh; else refresh only when date_last > target.date_fetched.

// ============================================================
// PER-TICKER REFRESH

// ============================================================

function _saRefreshTicker_(sheet, row, colTicker, colDateLast, page) {
  var colData = ScrapeCore.findColumn(sheet, SA_HEADERS[page]);
  var rawIde = sheet.getRange(row, colTicker).getValue();
  if (!rawIde) return false;
  var ide = String(rawIde).trim();
  var jdg = null;
  if (page === "Icm") {
    var colJdg = ScrapeCore.findColumn(sheet, SA_JDG_HEADER);
    jdg = sheet.getRange(row, colJdg).getValue();
    if (!_saJdgNonEmpty_(jdg)) return false;
  }
  var dateLast = ScrapeCore.parseDate(sheet.getRange(row, colDateLast).getValue());
  var targetCell = sheet.getRange(row, colData);
  var fn = SA_FUNCTIONS[page];
  if (!fn) throw new Error("Unknown SA page: " + page);
  var record = {
    index: row,
    ticker: ide,
    dateLast: dateLast,
    jdg: jdg,
    value: targetCell.getValue()
  };
  var result = ScrapeCore.runRefresh({
    rows: [record],
    needsRefresh: function (r) { return _needsRefresh_(r.value, r.dateLast); },
    eligibilityPredicate: function (r) {
      return !!r.ticker && (page !== "Icm" || _saJdgNonEmpty_(r.jdg));
    },
    fetch: function (r) { return fn(r.ticker); },
    policy: {
      onTransientFailure: "overwrite_empty",
      onEmptyExistingTransient: "overwrite_empty",
      onException: "overwrite_empty",
      onFalse: "overwrite_empty",
      onNotFound: "serialize_as_data"
    },
    write: function (r, value) { targetCell.setValue(value); },
    onException: function (r, error) {
      Logger.log("SA " + page + " threw for " + r.ticker + ": " + error.message);
    },
    onFalse: function (r) {
      Logger.log("SA " + page + " returned no valid data for " + r.ticker);
    }
  });
  return result.writeCount > 0;
}
// MAIN REFRESH

// ============================================================

function refreshSA_() {
  var sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(SA_SHEET_NAME);
  if (!sheet) {
    throw new Error(
      'Sheet "' + SA_SHEET_NAME + '" not found.'
    );
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return;
  }
  var colTicker = ScrapeCore.findColumn(
    sheet,
    SA_TICKERS_HEADER
  );
  var colDateLast = ScrapeCore.findColumn(
    sheet,
    SA_DATE_LAST_HEADER
  );
  var tickers = sheet
    .getRange(2, colTicker, lastRow - 1, 1)
    .getValues();
  var pages = [
    "Nly",
    "Frc",
    "Icm",
    "Bal",
    "Flo",
    "Kpi"
  ];
  for (var i = 0; i < tickers.length; i++) {
    var row = i + 2;
    var ide = tickers[i][0];
    if (!ide) {
      continue;
    }
    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      try {
        var refreshed = _saRefreshTicker_(
          sheet,
          row,
          colTicker,
          colDateLast,
          page
        );
        if (refreshed) {
          Logger.log(
            "Refreshed " +
            SA_HEADERS[page] +
            " for " + ide
          );
        }
      } catch (e) {
        Logger.log(
          "Unhandled SA " +
          page +
          " error for " +
          ide +
          ": " +
          e.message
        );
      }
      // Avoid hammering StockAnalysis.
      Utilities.sleep(300);
    }
  }
}

// ============================================================
// INDIVIDUAL PAGE REFRESHES
//
// Useful if you want separate triggers later.

// ============================================================

function refreshSA_Nly() {
  _refreshSA_Page_("Nly");
}

function refreshSA_Frc() {
  _refreshSA_Page_("Frc");
}

function refreshSA_Icm() {
  _refreshSA_Page_("Icm");
}

function refreshSA_Bal() {
  _refreshSA_Page_("Bal");
}

function refreshSA_Flo() {
  _refreshSA_Page_("Flo");
}

function refreshSA_Kpi() {
  _refreshSA_Page_("Kpi");
}

function _saComputeRefresh_(ide, dateLast, currentValue, page) {
  if (!_needsRefresh_(currentValue, dateLast)) {
    return null; // no change needed
  }
  var fn = SA_FUNCTIONS[page];
  if (!fn) throw new Error("Unknown SA page: " + page);
  var data;
  try {
    data = fn(ide);
  } catch (e) {
    Logger.log("SA " + page + " threw for " + ide + ": " + e.message);
    data = null;
  }
  if (data === ScrapeCore.NOT_FOUND) {
    // Confirmed absent -- record it so we don't hammer a 404 every run.
    return JSON.stringify({ date_fetched: new Date().toISOString(), data: {} });
  }
  if (data === false || data === null) {
    // Transient failure or bad content -- per spec, leave existing target unchanged.
    if (data === false) Logger.log("SA " + page + " returned no valid data for " + ide);
    return "__SKIP__";
  }
  return JSON.stringify({ date_fetched: new Date().toISOString(), data: data });
}

function _refreshSA_Page_(page) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SA_SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SA_SHEET_NAME + '" not found.');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var n = lastRow - 1;
  var colTicker = ScrapeCore.findColumn(sheet, SA_TICKERS_HEADER);
  var colDateLast = ScrapeCore.findColumn(sheet, SA_DATE_LAST_HEADER);
  var colData = ScrapeCore.findColumn(sheet, SA_HEADERS[page]);
  var colJdg = page === "Icm" ? ScrapeCore.findColumn(sheet, SA_JDG_HEADER) : null;
  var tickers = sheet.getRange(2, colTicker, n, 1).getValues();
  var dateLasts = sheet.getRange(2, colDateLast, n, 1).getValues();
  var jdgs = colJdg ? sheet.getRange(2, colJdg, n, 1).getValues() : null;
  var dataRange = sheet.getRange(2, colData, n, 1);
  var currentValues = dataRange.getValues();
  var rows = [];
  for (var i = 0; i < n; i++) {
    rows.push({
      index: i,
      ticker: tickers[i][0],
      dateLast: ScrapeCore.parseDate(dateLasts[i][0]),
      jdg: colJdg ? jdgs[i][0] : null,
      value: currentValues[i][0]
    });
  }
  var fn = SA_FUNCTIONS[page];
  ScrapeCore.runRefresh({
    rows: rows,
    eligibilityPredicate: function (r) {
      return !!r.ticker && (page !== "Icm" || _saJdgNonEmpty_(r.jdg));
    },
    needsRefresh: function (r) { return _needsRefresh_(r.value, r.dateLast); },
    fetch: function (r) { return fn(String(r.ticker).trim()); },
    policy: {
      onTransientFailure: "preserve_existing",
      onEmptyExistingTransient: "overwrite_empty",
      onException: "preserve_or_empty",
      onFalse: "preserve_or_empty",
      onNotFound: "overwrite_empty"
    },
    maxRows: SA_MAX_ROWS_PER_RUN,
    timeBudgetMs: SA_TIME_BUDGET_MS,
    flushEvery: SA_FLUSH_EVERY,
    flush: function (allRows) {
      allRows.forEach(function (r) { currentValues[r.index][0] = r.value; });
      dataRange.setValues(currentValues);
    },
    sleepMs: SA_BASE_SLEEP_MS,
    sleepAfter: function (info) { return info.index < info.total - 1; },
    onSelection: function (dueCount) {
      Logger.log(SA_HEADERS[page] + ": " + dueCount + " of " + n + " rows due");
    },
    onCapped: function (dueCount, limit) {
      Logger.log("Capping to " + limit + " rows this run (" + dueCount + " due)");
    },
    onTimeBudget: function (at, total) {
      Logger.log("Time budget reached -- stopping at " + at + "/" + total + " (progress saved)");
    },
    onException: function (r, error) {
      Logger.log("SA " + page + " threw for " + String(r.ticker).trim() + ": " + error.message);
    },
    onFalse: function (r) {
      Logger.log("SA " + page + " returned no valid data for " + String(r.ticker).trim());
    }
  });
}
// FORCE REFRESH — ONE FUNCTION PER SA_* DATASET
//
// These ignore date_last and refresh every non-empty ticker.

// ============================================================

function forceRefreshSA_Nly() {
  _forceRefreshSA_Page_("Nly");
}

function forceRefreshSA_Frc() {
  _forceRefreshSA_Page_("Frc");
}

function forceRefreshSA_Icm() {
  _forceRefreshSA_Page_("Icm");
}

function forceRefreshSA_Bal() {
  _forceRefreshSA_Page_("Bal");
}

function forceRefreshSA_Flo() {
  _forceRefreshSA_Page_("Flo");
}

function forceRefreshSA_Kpi() {
  _forceRefreshSA_Page_("Kpi");
}

function _forceRefreshSA_Page_(page) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SA_SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + SA_SHEET_NAME + '" not found.');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var colTicker = ScrapeCore.findColumn(sheet, SA_TICKERS_HEADER);
  var colData = ScrapeCore.findColumn(sheet, SA_HEADERS[page]);
  var colJdg = page === "Icm" ? ScrapeCore.findColumn(sheet, SA_JDG_HEADER) : null;
  var tickers = sheet.getRange(2, colTicker, lastRow - 1, 1).getValues();
  var jdgs = colJdg ? sheet.getRange(2, colJdg, lastRow - 1, 1).getValues() : null;
  var rows = [];
  for (var i = 0; i < tickers.length; i++) {
    rows.push({ index: i, ticker: tickers[i][0], jdg: colJdg ? jdgs[i][0] : null });
  }
  var fn = SA_FUNCTIONS[page];
  ScrapeCore.runRefresh({
    rows: rows,
    eligibilityPredicate: function (r) {
      return !!r.ticker && (page !== "Icm" || _saJdgNonEmpty_(r.jdg));
    },
    fetch: function (r) { return fn(String(r.ticker).trim()); },
    policy: {
      onTransientFailure: "overwrite_empty",
      onException: "preserve_existing",
      onFalse: "preserve_existing",
      onNotFound: "serialize_as_data"
    },
    write: function (r, value) { sheet.getRange(r.index + 2, colData).setValue(value); },
    onException: function (r, error) {
      Logger.log("Force SA_" + page + " failed for " + String(r.ticker).trim() + ": " + error.message);
    },
    onFalse: function (r) {
      Logger.log("SA_" + page + " returned no data for " + String(r.ticker).trim());
    },
    sleepMs: 300,
    sleepAfter: function (info) {
      // The legacy force loop continued before sleep for null and false returns;
      // it slept after successful data, NOT_FOUND serialization, and exceptions.
      return info.kind !== "null" && info.kind !== "false";
    }
  });
}

function _saDebugTableIds_(ide) {
  var html = _saHtmlOf_(ide, "financials/cash-flow-statement");
  var tables = ScrapeCore.elements(html, "table");
  Logger.log("Found " + tables.length + " <table> elements");
  tables.forEach(function (t, i) {
    var tag = ScrapeCore.openingTag(t, "table");
    Logger.log(i + ": id=" + ScrapeCore.attr(tag, "id") + " class=" + ScrapeCore.attr(tag, "class"));
  });
}

function testDebugTableIds_Bal() {
  var html = _saHtmlOf_("us-MSFT", "financials/balance-sheet");
  if (html === ScrapeCore.NOT_FOUND) { Logger.log("404"); return; }
  if (!html) { Logger.log("fetch failed"); return; }
  var tables = ScrapeCore.elements(html, "table");
  Logger.log("Found " + tables.length + " <table> elements");
  tables.forEach(function (t, i) {
    var tag = ScrapeCore.openingTag(t, "table");
    Logger.log(i + ": id=" + ScrapeCore.attr(tag, "id") + " class=" + ScrapeCore.attr(tag, "class"));
  });
}

function testDiag_Bal() {
  var url = _saUrl_("us-IREN", "financials/balance-sheet");
  var resp = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  Logger.log("HTTP status: " + code);
  Logger.log("Body length: " + body.length);
  Logger.log("First 500 chars: " + body.substring(0, 500));
  var tables = ScrapeCore.elements(body, "table");
  Logger.log("Table count: " + tables.length);
  tables.forEach(function (t, i) {
    var tag = ScrapeCore.openingTag(t, "table");
    Logger.log(i + ": id=" + ScrapeCore.attr(tag, "id") + " class=" + ScrapeCore.attr(tag, "class"));
  });
}

function testDebugTableIds() {
  _saDebugTableIds_("us-IREN");
}

function testSA_Icm() {
  var ide = "us-AMZN";
  for (var i = 0; i < 3; i++) {
    var result = SA_Icm(ide);
    if (result !== null) { Logger.log(JSON.stringify(result)); return; }
    Logger.log("Blocked, retrying in 15s...");
    Utilities.sleep(15000);
  }
  Logger.log("Still blocked after retries.");
}