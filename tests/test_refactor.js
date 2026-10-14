const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');

const logs = [];
const sleeps = [];
let fetchConfig = null;
const sandbox = {
  Logger: { log: (message) => logs.push(String(message)) },
  Utilities: { sleep: (milliseconds) => sleeps.push(milliseconds) },
  UrlFetchApp: { fetch: (url, options) => {
    fetchConfig = { url, options };
    const response = sandbox.__response || { code: 200, body: '<html></html>' };
    return {
      getResponseCode: () => response.code,
      getContentText: () => response.body
    };
  } },
  SpreadsheetApp: {},
  __response: { code: 200, body: '<html></html>' }
};
sandbox.Date = class SandboxDate extends Date {};
sandbox.Date.now = Date.now;
vm.createContext(sandbox);
const coreSource = fs.readFileSync(__dirname + '/ScrapeCore.gs', 'utf8');
const adapterSource = fs.readFileSync(__dirname + '/StockAnalysis.gs', 'utf8');
const sha256 = (source) => crypto.createHash('sha256').update(source, 'utf8').digest('hex');
vm.runInContext(coreSource, sandbox, { filename: 'ScrapeCore.gs' });
vm.runInContext(adapterSource, sandbox, { filename: 'StockAnalysis.gs' });
const core = sandbox.ScrapeCore;

let passed = 0;
function check(name, callback) {
  callback();
  passed++;
  console.log('PASS ' + name);
}

check('generic HTML helpers', () => {
  assert.strictEqual(core.attr('<td class="desktop-only" id="rev">', 'class'), 'desktop-only');
  assert.strictEqual(core.hasClass('<td class="alpha desktop-only">', 'desktop-only'), true);
  assert.strictEqual(core.hasClass('<td class="desktop-onlyish">', 'desktop-only'), false);
  assert.strictEqual(core.text('<p>Revenue&nbsp;&amp; profit<br>2</p>'), 'Revenue & profit 2');
  assert.strictEqual(core.text('<div>visible<script>bad()</script><style>.x{}</style></div>'), 'visible');
  assert.strictEqual(core.elements('<table><tr><td>1</td></tr></table>', 'table').length, 1);
  assert.strictEqual(core.cells('<tr><th>A</th><td>2</td></tr>').length, 2);
  assert.strictEqual(core.innerHtml('<p class="x">value</p>', 'p'), 'value');
});

check('forecast heading parser pairs headings with complete tables', () => {
  const html = [
    '<h2>Revenue Forecast</h2>',
    '<table id="revenue"><tr><td>Revenue</td></tr></table>',
    '<h2>EPS Forecast</h2>',
    '<table id="eps"><tr><td>EPS</td></tr></table>'
  ].join('');
  const byHeading = sandbox._saTablesByHeading_(html);
  assert.ok(byHeading['Revenue Forecast'].includes('id="revenue"'));
  assert.ok(byHeading['EPS Forecast'].includes('id="eps"'));
  assert.strictEqual(Object.keys(byHeading).length, 2);
});

check('adapter core API and boundary are complete', () => {
  const used = Array.from(
    adapterSource.matchAll(/\bScrapeCore\.([A-Za-z_$][\w$]*)/g),
    (match) => match[1]
  );
  const missing = [...new Set(used)].filter((name) => !(name in core));
  assert.deepStrictEqual(missing, []);

  const required = [
    'runRefresh', 'cleanCell', 'elements', 'innerHtml', 'cells',
    'openingTag', 'text', 'attr', 'hasClass', 'parseDate',
    'findColumn', 'fetchHtml', 'NOT_FOUND'
  ];
  for (const symbol of required) {
    assert.ok(symbol in core, 'ScrapeCore.' + symbol + ' must be exported');
  }
  assert.doesNotMatch(
    coreSource,
    /\bSA_[A-Za-z0-9_$]*\b|\bJdg\b|_needsRefresh_|_saJdgNonEmpty_/
  );
});

check('generic cell cleaning', () => {
  assert.strictEqual(core.cleanCell('12,345.67', {}, '¥$€'), 12345.67);
  assert.strictEqual(core.cleanCell('¥12,345', {}, '¥$€'), 12345);
  assert.strictEqual(core.cleanCell('25%', {}, '¥$€'), 0.25);
  assert.strictEqual(core.cleanCell('N/A', { 'N/A': true }, '¥$€'), null);
  assert.strictEqual(core.cleanCell('FY 2027', {}, '¥$€'), 'FY 2027');
});

check('date parser handles valid and invalid values', () => {
  assert.strictEqual(core.parseDate('not-a-date'), null);
  assert.strictEqual(Object.prototype.toString.call(core.parseDate('2025-01-02T00:00:00Z')), '[object Date]');
  assert.strictEqual(core.parseDate(null), null);
});

check('fetch adapter options and HTTP result mapping', () => {
  sandbox.__response = { code: 200, body: 'ok' };
  assert.strictEqual(core.fetchHtml('https://example.test', { userAgent: 'UA-TEST', logPrefix: 'Tag' }), 'ok');
  assert.strictEqual(fetchConfig.options.headers['User-Agent'], 'UA-TEST');
  sandbox.__response = { code: 404, body: 'missing' };
  assert.strictEqual(core.fetchHtml('https://example.test', { logPrefix: 'Tag' }), core.NOT_FOUND);
  sandbox.__response = { code: 429, body: 'slow down' };
  assert.strictEqual(core.fetchHtml('https://example.test', { logPrefix: 'Tag' }), null);
});

const policies = {
  ticker: {
    onTransientFailure: 'overwrite_empty', onEmptyExistingTransient: 'overwrite_empty',
    onException: 'overwrite_empty', onFalse: 'overwrite_empty', onNotFound: 'serialize_as_data'
  },
  page: {
    onTransientFailure: 'preserve_existing', onEmptyExistingTransient: 'overwrite_empty',
    onException: 'preserve_or_empty', onFalse: 'preserve_or_empty', onNotFound: 'overwrite_empty'
  },
  force: {
    onTransientFailure: 'overwrite_empty', onException: 'preserve_existing',
    onFalse: 'preserve_existing', onNotFound: 'serialize_as_data'
  }
};
function runPolicy(driver, outcome, hadExisting) {
  const row = { index: 0, ticker: 'us-TEST', value: hadExisting ? '{"old":true}' : '' };
  const writes = [];
  core.runRefresh({
    rows: [row],
    fetch: () => {
      if (outcome === 'thrown') throw new Error('test exception');
      if (outcome === 'null') return null;
      if (outcome === 'false') return false;
      if (outcome === 'not_found') return core.NOT_FOUND;
      return { fresh: true };
    },
    policy: policies[driver],
    write: (_row, value) => writes.push(value),
    onException: () => {},
    onFalse: () => {}
  });
  return { row, writes };
}

function expected(driver, outcome, hadExisting) {
  if (outcome === 'valid') return { writes: 1, data: { fresh: true } };
  if (outcome === 'not_found') {
    return driver === 'page'
      ? { writes: 1, data: {} }
      : { writes: 1, data: { notFound: true } };
  }
  if (driver === 'ticker') return { writes: 1, data: {} };
  if (driver === 'page') return hadExisting ? { writes: 0 } : { writes: 1, data: {} };
  if (driver === 'force') {
    if (outcome === 'null') return { writes: 1, data: {} };
    return { writes: 0 };
  }
  throw new Error('unknown expected case');
}

for (const driver of Object.keys(policies)) {
  for (const outcome of ['null', 'thrown', 'false', 'valid', 'not_found']) {
    for (const hadExisting of [false, true]) {
      check('outcome matrix ' + driver + '/' + outcome + '/existing=' + hadExisting, () => {
        const actual = runPolicy(driver, outcome, hadExisting);
        const wanted = expected(driver, outcome, hadExisting);
        assert.strictEqual(actual.writes.length, wanted.writes);
        if (wanted.writes) {
          const envelope = JSON.parse(actual.writes[0]);
          assert.deepStrictEqual(JSON.parse(JSON.stringify(envelope.data)), wanted.data);
          assert.ok(!isNaN(Date.parse(envelope.date_fetched)));
        }
      });
    }
  }
}

function makeSheet(initialData) {
  const headers = ['tickers', 'date_last', 'Jdg', 'SA_nly', 'SA_frc', 'SA_icm', 'SA_bal', 'SA_flo', 'SA_kpi'];
  const values = [headers, ['us-TEST', new Date('2025-01-01T00:00:00Z'), 'eligible', initialData, initialData, initialData, initialData, initialData, initialData]];
  return {
    values,
    getName: () => 'Upk',
    getLastRow: () => values.length,
    getLastColumn: () => headers.length,
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      getValue: () => values[row - 1][col - 1],
      setValue: (value) => { values[row - 1][col - 1] = value; },
      getValues: () => values.slice(row - 1, row - 1 + numRows).map((cells) => cells.slice(col - 1, col - 1 + numCols)),
      setValues: (newValues) => {
        for (let r = 0; r < newValues.length; r++) {
          for (let c = 0; c < newValues[r].length; c++) values[row - 1 + r][col - 1 + c] = newValues[r][c];
        }
      }
    })
  };
}

const datasets = ['Nly', 'Frc', 'Icm', 'Bal', 'Flo', 'Kpi'];
function runRealWrapper(driver, dataset, outcome, hadExisting) {
  const sheet = makeSheet(hadExisting ? '{"old":true}' : '');
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sheet });
  sandbox._needsRefresh_ = () => true;
  sandbox.SA_FUNCTIONS[dataset] = () => {
    if (outcome === 'thrown') throw new Error('wrapper exception');
    if (outcome === 'null') return null;
    if (outcome === 'false') return false;
    if (outcome === 'not_found') return core.NOT_FOUND;
    return { fresh: true };
  };
  if (driver === 'ticker') sandbox._saRefreshTicker_(sheet, 2, 1, 2, dataset);
  else if (driver === 'page') sandbox._refreshSA_Page_(dataset);
  else sandbox._forceRefreshSA_Page_(dataset);
  const header = sandbox.SA_HEADERS[dataset];
  const targetColumn = sheet.values[0].indexOf(header);
  const value = sheet.values[1][targetColumn];
  if (value === (hadExisting ? '{"old":true}' : '')) return { writes: 0 };
  const envelope = JSON.parse(value);
  return { writes: 1, data: JSON.parse(JSON.stringify(envelope.data)) };
}

for (const driver of Object.keys(policies)) {
  for (const dataset of datasets) {
    for (const outcome of ['null', 'thrown', 'false', 'valid', 'not_found']) {
      for (const hadExisting of [false, true]) {
        check('adapter matrix ' + driver + '/' + dataset + '/' + outcome + '/existing=' + hadExisting, () => {
          const actual = runRealWrapper(driver, dataset, outcome, hadExisting);
          const wanted = expected(driver, outcome, hadExisting);
          assert.strictEqual(actual.writes, wanted.writes);
          if (wanted.writes) assert.deepStrictEqual(actual.data, wanted.data);
        });
      }
    }
  }
}

check('Icm eligibility gate is callable from every refresh path', () => {
  const sheet = makeSheet('');
  sheet.values[1][2] = '  ';
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sheet });
  sandbox._needsRefresh_ = () => true;
  let calls = 0;
  sandbox.SA_FUNCTIONS.Icm = () => { calls++; return { fresh: true }; };
  assert.strictEqual(sandbox._saRefreshTicker_(sheet, 2, 1, 2, 'Icm'), false);
  sandbox._refreshSA_Page_('Icm');
  sandbox._forceRefreshSA_Page_('Icm');
  assert.strictEqual(calls, 0);
});

check('batch limits and periodic/final flushes', () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ index, ticker: 'us-' + index, value: '' }));
  let flushes = 0;
  let calls = 0;
  const result = core.runRefresh({
    rows,
    fetch: () => { calls++; return { ok: true }; },
    policy: { onTransientFailure: 'preserve_existing' },
    maxRows: 21,
    flushEvery: 20,
    flush: () => { flushes++; },
    sleepMs: 1,
    sleepAfter: (info) => info.index < info.total - 1
  });
  assert.strictEqual(result.dueCount, 25);
  assert.strictEqual(result.selectedCount, 21);
  assert.strictEqual(calls, 21);
  assert.strictEqual(flushes, 2);
  assert.strictEqual(sleeps.filter((x) => x === 1).length, 20);
});

check('runner selection, due-state, cap callbacks, and write injection', () => {
  const rows = [
    { index: 0, ticker: 'us-A', value: '' },
    { index: 1, ticker: '', value: '' },
    { index: 2, ticker: 'us-B', value: '' },
    { index: 3, ticker: 'us-C', value: 'fresh' }
  ];
  const written = [];
  let selection;
  let cap;
  const result = core.runRefresh({
    rows,
    eligibilityPredicate: (row) => Boolean(row.ticker),
    needsRefresh: (row) => row.value !== 'fresh',
    fetch: (row) => ({ ticker: row.ticker }),
    policy: { onTransientFailure: 'preserve_existing' },
    maxRows: 1,
    onSelection: (...args) => { selection = args; },
    onCapped: (...args) => { cap = args; },
    write: (row, value) => written.push({ index: row.index, value })
  });
  assert.deepStrictEqual(selection, [2, 4, 3]);
  assert.deepStrictEqual(cap, [2, 1]);
  assert.strictEqual(result.dueCount, 2);
  assert.strictEqual(result.selectedCount, 1);
  assert.strictEqual(result.processedCount, 1);
  assert.strictEqual(result.writeCount, 1);
  assert.strictEqual(written[0].index, 0);
});

check('runner time budget invokes callback and stops processing', () => {
  const originalNow = sandbox.Date.now;
  const times = [100, 100, 102];
  sandbox.Date.now = () => times.length ? times.shift() : 102;
  try {
    let fetched = 0;
    let budget;
    const result = core.runRefresh({
      rows: [
        { index: 0, ticker: 'us-A', value: '' },
        { index: 1, ticker: 'us-B', value: '' }
      ],
      timeBudgetMs: 1,
      fetch: () => { fetched++; return { ok: true }; },
      policy: { onTransientFailure: 'preserve_existing' },
      onTimeBudget: (...args) => { budget = args; }
    });
    assert.strictEqual(fetched, 1);
    assert.deepStrictEqual(budget, [1, 2]);
    assert.strictEqual(result.processedCount, 1);
  } finally {
    sandbox.Date.now = originalNow;
  }
});

check('runner exposes exception and false-result callbacks', () => {
  let exceptionCalls = 0;
  let falseCalls = 0;
  core.runRefresh({
    rows: [
      { index: 0, ticker: 'us-ERR', value: '' },
      { index: 1, ticker: 'us-FALSE', value: '' }
    ],
    fetch: (row) => {
      if (row.ticker === 'us-ERR') throw new Error('expected');
      return false;
    },
    policy: {
      onException: 'preserve_or_empty',
      onFalse: 'preserve_or_empty'
    },
    onException: () => { exceptionCalls++; },
    onFalse: () => { falseCalls++; }
  });
  assert.strictEqual(exceptionCalls, 1);
  assert.strictEqual(falseCalls, 1);
});

check('404 sentinel preserves parser-specific legacy behavior', () => {
  sandbox.__response = { code: 404, body: 'missing' };
  assert.strictEqual(sandbox.SA_Icm('us-TEST'), core.NOT_FOUND);
  assert.strictEqual(sandbox.SA_Bal('us-TEST'), core.NOT_FOUND);
  assert.strictEqual(sandbox.SA_Flo('us-TEST'), core.NOT_FOUND);
  assert.throws(() => sandbox.SA_Nly('us-TEST'), /match is not a function/);
  assert.throws(() => sandbox.SA_Frc('us-TEST'), /match is not a function/);
  assert.throws(() => sandbox.SA_Kpi('us-TEST'), /match is not a function/);
});

check('StockAnalysis entry points and adapter loaded', () => {
  assert.strictEqual(typeof sandbox.SA_Nly, 'function');
  assert.strictEqual(typeof sandbox.SA_Icm, 'function');
  assert.strictEqual(typeof sandbox.refreshSA_, 'function');
  assert.strictEqual(typeof sandbox.forceRefreshSA_Kpi, 'function');
  assert.strictEqual(sandbox._saJdgNonEmpty_('x'), true);
  assert.strictEqual(sandbox._saJdgNonEmpty_('  '), false);
});

console.log('\nRESULT: ' + passed + ' checks passed; 0 failed.');
console.log('SHA-256 ScrapeCore.gs: ' + sha256(coreSource));
console.log('SHA-256 StockAnalysis.gs: ' + sha256(adapterSource));