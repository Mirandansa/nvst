/**
 * Reusable scraping primitives and refresh runner.
 * Load before StockAnalysis.gs for easier code navigation; Apps Script shares
 * the project namespace across .gs files, so all reusable members are namespaced.
 */
var ScrapeCore = (function () {
  var NOT_FOUND = { notFound: true };

  function findColumn(sheet, header) {
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) throw new Error("Sheet has no columns: " + sheet.getName());
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim() === header) return i + 1;
    }
    throw new Error('Header "' + header + '" not found in sheet "' + sheet.getName() + '"');
  }

  function fetchHtml(url, options) {
    options = options || {};
    var prefix = options.logPrefix || "Scrape";
    var userAgent = options.userAgent || "Mozilla/5.0";
    var response = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      headers: { "User-Agent": userAgent }
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    var isBlocked = typeof options.blockDetector === "function" && options.blockDetector(body);

    if (code === 429 || isBlocked) {
      Logger.log(prefix + " blocked/rate-limited: " + code + " " + url);
      return null;
    }
    if (code === 404) return NOT_FOUND;
    if (code !== 200) {
      Logger.log(prefix + " fetch failed: " + code + " " + url + " -- " + body.substring(0, 300));
      return null;
    }
    return body;
  }

  function attr(tag, name) {
    var escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("\\b" + escaped + "\\s*=\\s*[\"']([^\"']*)[\"']", "i");
    var match = String(tag).match(re);
    return match ? match[1] : null;
  }

  function hasClass(tag, className) {
    var classes = attr(tag, "class");
    return !!classes && classes.split(/\s+/).indexOf(className) !== -1;
  }

  function text(html) {
    if (!html) return "";
    html = html
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
    return html.replace(/\s+/g, " ").trim();
  }

  function elements(html, tagName) {
    if (!html) return [];
    var escapedTag = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("<" + escapedTag + "\\b[^>]*>[\\s\\S]*?<\\/" + escapedTag + ">", "gi");
    return html.match(re) || [];
  }

  function openingTag(element, tagName) {
    var escapedTag = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var match = element.match(new RegExp("^<" + escapedTag + "\\b[^>]*>", "i"));
    return match ? match[0] : "";
  }

  function innerHtml(element, tagName) {
    var escapedTag = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var open = new RegExp("^<" + escapedTag + "\\b[^>]*>", "i");
    var close = new RegExp("<\\/" + escapedTag + ">\\s*$", "i");
    return element.replace(open, "").replace(close, "");
  }

  function cells(row) {
    var result = [];
    var re = /<(th|td)\b[^>]*>[\s\S]*?<\/\1>/gi;
    var match;
    while ((match = re.exec(String(row))) !== null) {
      var element = match[0];
      result.push({
        name: match[1].toLowerCase(),
        html: element,
        tag: openingTag(element, match[1]),
        inner: innerHtml(element, match[1])
      });
    }
    return result;
  }

  function findByClass(html, tagName, className) {
    var found = elements(html, tagName);
    for (var i = 0; i < found.length; i++) {
      if (hasClass(openingTag(found[i], tagName), className)) return found[i];
    }
    return null;
  }

  function cleanCell(value, placeholders, currencySymbols) {
    var valueText = String(value).trim();
    placeholders = placeholders || {};
    if (Object.prototype.hasOwnProperty.call(placeholders, valueText)) return null;

    if (valueText.charAt(valueText.length - 1) === "%") {
      var percentage = Number(valueText.substring(0, valueText.length - 1).replace(/,/g, ""));
      return isNaN(percentage) ? valueText : percentage / 100;
    }

    var symbols = String(currencySymbols || "").split("").map(function (symbol) {
      return symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    var prefix = symbols ? "[" + symbols + "]?" : "";
    var numericPattern = new RegExp("^" + prefix + "[+-]?[\\d,]+(\\.\\d+)?$");
    if (numericPattern.test(valueText)) {
      var stripPattern = symbols ? new RegExp("^[" + symbols + "]") : null;
      var numberText = (stripPattern ? valueText.replace(stripPattern, "") : valueText).replace(/,/g, "");
      var number = Number(numberText);
      if (!isNaN(number)) return number;
    }
    return valueText;
  }

  function parseDate(value) {
    if (value === null || value === undefined || value === "") return null;
    if (Object.prototype.toString.call(value) === "[object Date]") {
      return isNaN(value.getTime()) ? null : value;
    }
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function emptyEnvelope() {
    return JSON.stringify({ date_fetched: new Date().toISOString(), data: {} });
  }

  function dataEnvelope(value) {
    return JSON.stringify({ date_fetched: new Date().toISOString(), data: value });
  }

  function applyAction(row, action, options, result) {
    if (action === "preserve_existing") return false;
    if (action === "preserve_or_empty") {
      if (row.value) return false;
      action = "overwrite_empty";
    }
    if (action === "overwrite_empty") return store(row, emptyEnvelope(), options);
    if (action === "serialize_as_data") return store(row, dataEnvelope(result), options);
    throw new Error("Unknown refresh outcome action: " + action);
  }

  function store(row, value, options) {
    row.value = value;
    row.changed = true;
    if (typeof options.write === "function") options.write(row, value);
    return true;
  }

  /**
   * Generic refresh runner. Site/workbook rules are injected as callbacks and
   * policy values; workbook and site configuration enter only through callbacks.
   * Outcome actions: preserve_existing | overwrite_empty | preserve_or_empty
   * plus serialize_as_data for confirmed-not-found sentinels.
   */
  function runRefresh(options) {
    options = options || {};
    var rows = options.rows || [];
    var eligibility = options.eligibilityPredicate || function () { return true; };
    var needsRefresh = options.needsRefresh || function () { return true; };
    var eligibleRows = rows.filter(eligibility);
    var dueRows = eligibleRows.filter(needsRefresh);
    var initialDueCount = dueRows.length;

    if (typeof options.onSelection === "function") options.onSelection(initialDueCount, rows.length, eligibleRows.length);
    if (options.maxRows && dueRows.length > options.maxRows) {
      if (typeof options.onCapped === "function") options.onCapped(dueRows.length, options.maxRows);
      dueRows = dueRows.slice(0, options.maxRows);
    }

    var policy = options.policy || {};
    var startTime = Date.now();
    var dirty = false;
    var processed = 0;
    var writes = 0;
    var infos = [];

    for (var i = 0; i < dueRows.length; i++) {
      if (options.timeBudgetMs && Date.now() - startTime > options.timeBudgetMs) {
        if (typeof options.onTimeBudget === "function") options.onTimeBudget(i, dueRows.length);
        break;
      }

      var row = dueRows[i];
      row.changed = false;
      var value;
      var kind;
      var error = null;
      try {
        value = options.fetch(row);
        if (value === null) kind = "null";
        else if (value === false) kind = "false";
        else if (value === NOT_FOUND) kind = "not_found";
        else kind = "valid";
      } catch (err) {
        error = err;
        kind = "exception";
      }

      var wrote = false;
      if (kind === "exception") {
        if (typeof options.onException === "function") options.onException(row, error);
        var exceptionAction = policy.onException || policy.onTransientFailure || "preserve_existing";
        wrote = applyAction(row, exceptionAction, options, value);
      } else if (kind === "null") {
        var nullAction = policy.onTransientFailure || "preserve_existing";
        if (!row.value && policy.onEmptyExistingTransient) nullAction = policy.onEmptyExistingTransient;
        wrote = applyAction(row, nullAction, options, value);
      } else if (kind === "false") {
        if (typeof options.onFalse === "function") options.onFalse(row);
        wrote = applyAction(row, policy.onFalse || "preserve_existing", options, value);
      } else if (kind === "not_found") {
        var notFoundAction = policy.onNotFound || "serialize_as_data";
        wrote = applyAction(row, notFoundAction, options, value);
      } else {
        wrote = store(row, dataEnvelope(value), options);
      }

      if (wrote) {
        writes++;
        dirty = true;
      }
      processed++;
      var info = { row: row, kind: kind, result: value, error: error, wrote: wrote, index: i, total: dueRows.length };
      infos.push(info);

      if (options.flush && dirty && options.flushEvery && processed % options.flushEvery === 0) {
        options.flush(rows);
      }

      if (options.sleepMs && options.sleepMs > 0 && typeof options.sleepAfter === "function" && options.sleepAfter(info)) {
        Utilities.sleep(options.sleepMs);
      }
    }

    if (options.flush && dirty) options.flush(rows);
    return { dueCount: initialDueCount, selectedCount: dueRows.length, processedCount: processed, writeCount: writes, infos: infos };
  }

  return {
    NOT_FOUND: NOT_FOUND,
    findColumn: findColumn,
    fetchHtml: fetchHtml,
    attr: attr,
    hasClass: hasClass,
    text: text,
    elements: elements,
    openingTag: openingTag,
    innerHtml: innerHtml,
    cells: cells,
    findByClass: findByClass,
    cleanCell: cleanCell,
    parseDate: parseDate,
    runRefresh: runRefresh
  };
})();