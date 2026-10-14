---
artifact_id: stockanalysis_scraper_refactor_proposal
version: 0.1
status: PROPOSED
artifact_type: refactor-proposal
source_file: "Pasted markdown(1).md"
source_sha256: "ea7acc1348dbe9b174c16c3d534a25b1fb6e76dd39ba7821df68751f9fee5c6f"
protocol_file: "project_work_protocol_compact(1).md"
protocol_version: "1.1"
protocol_status: PROPOSED
intent: "Separate StockAnalysis-specific logic from reusable scraping utilities while preserving existing Apps Script interfaces."
---

# Refactor proposal: StockAnalysis scraper

## 1. Decision

- **PROPOSAL:** Separate the implementation into two modules: **ScrapeCore.gs** for reusable scraping primitives and **StockAnalysis.gs** for the StockAnalysis adapter, data parsing, Upk mapping, and public entry points.
- **PROPOSAL:** Preserve public function names, including SA_Nly, SA_Frc, SA_Icm, SA_Bal, SA_Flo, SA_Kpi, refreshSA_*, forceRefreshSA_*, and refreshSA_.
- **PROPOSAL:** Move only demonstrably site-agnostic mechanics. Pass site-specific choices into the core as arguments or callbacks.
- **BLOCKING:** Do not unify the refresh paths until their different result-handling semantics have an explicit disposition.
- **ASSUMPTION:** Preserve data shapes, public names, diagnostics, and unrelated behavior.

## 2. Module boundary

### 2.1 ScrapeCore.gs — reusable mechanics

| Proposed API | Responsibility | Existing source |
|---|---|---|
| ScrapeCore.findColumn(sheet, header) | Find a sheet column by header; retain current errors. | _saFindColumn_ (L117–L153) |
| ScrapeCore.fetchHtml(url, options) | Fetch a URL; distinguish success, confirmed 404, and transient failure; accept a supplied block detector. | _saFetchHtml_ (L217–L261) |
| ScrapeCore.NOT_FOUND | Shared identity sentinel for confirmed 404. | SA_NOT_FOUND (L201–L205) |
| ScrapeCore.attr(tag, name) | Read a quoted HTML attribute. | _saAttr_ (L291–L307) |
| ScrapeCore.hasClass(tag, className) | Match an exact whitespace-delimited class token. | _saHasClass_ (L313–L327) |
| ScrapeCore.text(html) | Remove scripts, styles and tags; decode currently supported entities; normalize whitespace. | _saText_ (L333–L419) |
| ScrapeCore.elements(html, tagName) | Extract simple paired elements by tag name. | _saElements_ (L425–L437) |
| ScrapeCore.openingTag(element, tagName) | Return an element opening tag. | _saOpeningTag_ (L445–L459) |
| ScrapeCore.innerHtml(element, tagName) | Remove named outer tags. | _saInnerHtml_ (L467–L495) |
| ScrapeCore.cells(row) | Extract th/td records with cell name, HTML, opening tag and inner HTML. | _saCells_ (L501–L529) |
| ScrapeCore.findByClass(html, tagName, className) | Find the first paired element matching a tag and class. | _saFindByClass_ (L1031–L1053) |
| ScrapeCore.cleanCell(text, placeholders) | Parse percentages and simple numeric/currency values; preserve other text; accept adapter placeholders. | _saCleanCell_ (L569–L637) |
| ScrapeCore.parseDate(value) | Parse a date or return null. | _saParseDate_ (L1525–L1547) |

**Core restrictions**

- ScrapeCore must not contain StockAnalysis domains or routes, table IDs/classes, forecast labels, SA header names, the Jdg rule, or the SA_FUNCTIONS dispatch table.
- The fetch core must receive the site's block detector. Cloudflare challenge phrases are not generic HTTP semantics.
- The value cleaner must receive the placeholder configuration. “Pro” and “Upgrade” are site-specific display placeholders.
- Preserve the existing lightweight regex-based HTML behavior; replacing it with a full parser is outside scope.
- A shared refresh runner may be considered only after Section 4 is resolved.

### 2.2 StockAnalysis.gs — adapter-specific logic

| Component | Why it remains in the adapter |
|---|---|
| SA_DOM, SA_HEADERS, SA_SHEET_NAME, SA_TICKERS_HEADER, SA_DATE_LAST_HEADER, SA_JDG_HEADER | Site identity, data categories, and Upk sheet mapping. |
| SA_TIME_BUDGET_MS, SA_FLUSH_EVERY, SA_BASE_SLEEP_MS, SA_BACKOFF_MS, SA_MAX_ROWS_PER_RUN | Current site-specific runtime and rate policy. SA_BACKOFF_MS is declared but appears unused. |
| _saUrl_, _saIsBlocked_, _saHtmlOf_ | URL grammar, anti-bot signatures, and site-fetch composition. _saHtmlOf_ delegates transport to the core. |
| SA_PLACEHOLDERS, _saIconId_ | Source-specific values and icon/metric IDs. |
| _saTableToDict_, _saMainTable_, _saMergeMainTables_, _saStatement_ | Table IDs, period layout, metric labels and financial-statement table semantics. |
| SA_Icm, SA_Bal, SA_Flo, SA_Kpi, _saParseRatingsTable_, SA_Nly, SA_MONTHS, _saNormalizeMonthPeriod_, _saTablesByHeading_, SA_Frc | Dataset-specific structure and interpretation. |
| SA_FUNCTIONS and public refresh/test/diagnostic functions | Adapter dispatch and compatibility-facing entry points. |
| Icm-only Jdg eligibility condition | Upk contract specific to this adapter. Pass it to generic code as a callback if needed. |

### 2.3 Mixed or unused helpers

- Replace SA_NOT_FOUND with ScrapeCore.NOT_FOUND while retaining sentinel identity semantics.
- Move _saFindColumn_ and _saParseDate_ to the core despite their current prefixes.
- _saFindByClass_ is generic; keep site-specific class names at adapter call sites.
- _saMainTable_ and _saComputeRefresh_ appear unused in the supplied source. Do not delete or repurpose them in this split; confirm external references separately.

## 3. Proposed convention

- **[NEW-CONVENTION]** ScrapeCore is one global namespace object for reusable scraper utilities. Existing public SA_* entry points remain global for compatibility. Apps Script files share a project namespace, so grouping generic helpers reduces collision risk.
- **[NEW-CONVENTION]** Site-specific options are passed into generic functions; core code does not read SA_* globals. This makes the separation inspectable and reusable by other adapters.

## 4. Blocking issue: refresh result semantics

The existing refresh paths differ, so they must not be silently collapsed.

| Path | null / thrown fetch or parse | false | Confirmed SA_NOT_FOUND |
|---|---|---|---|
| refreshSA_ → _saRefreshTicker_ | Writes an empty data envelope even if prior data exists. | Also writes an empty envelope. | Falls through as ordinary data and is serialized into data. |
| refreshSA_<Page> → _refreshSA_Page_ | Preserves existing data; writes an empty envelope only when target was empty. | Same target-preservation rule; logs false. | Writes an empty envelope. |
| forceRefreshSA_<Page> → _forceRefreshSA_Page_ | Writes an empty envelope. | Leaves target unchanged. | Falls through as ordinary data and is serialized into data. |
| _saComputeRefresh_ | Returns "__SKIP__". | Returns "__SKIP__". | Returns an empty envelope; helper appears unused. |

- **[FACT]** These differences occur in _saRefreshTicker_ (L1641–L1685), _refreshSA_Page_ (L2141–L2181), _forceRefreshSA_Page_ (L2275–L2413), and _saComputeRefresh_ (L1963–L2017).
- **[INFERENCE]** The first and force-refresh paths may preserve stale behavior: they conflict with the file-level statement that failed fetches/parses leave existing targets unchanged (L57–L58) and do not handle the 404 sentinel explicitly.
- **[BLOCKING]** Before a shared runner is implemented, either preserve these differences as explicit policy modes or approve a separate behavior change that normalizes them. The latter is outside this minimal refactor.
- **[FACT]** _saJdgNonEmpty_ is declared inside _refreshSA_Page_ but referenced by other functions (_saRefreshTicker_ and _forceRefreshSA_Page_). The nested declaration is not visible to those global functions. Move the predicate to adapter scope or pass it as a callback; otherwise the Icm gate can raise ReferenceError.

## 5. Contracts to preserve

- Continue using the shared _needsRefresh_ policy from Utils.gs; do not duplicate or redefine it.
- Preserve the stored JSON envelope shape: date_fetched and data.
- Preserve the distinction between confirmed HTTP 404 and transient fetch failure.
- Preserve batch writes, row cap, time budget, and delays unless a separate approved change says otherwise.
- Preserve the Icm-only Jdg row gate as adapter logic.
- Keep public function names and existing output schemas.

## 6. Implementation order

1. Add ScrapeCore.gs with only the reusable primitives in Section 2.1, preserving behavior and return types.
2. Update StockAnalysis call sites to use those core functions. Leave routes, anti-bot detection, placeholders, table schemas, dataset parsing and dispatch in StockAnalysis.gs.
3. Move the Jdg predicate to adapter scope and pass it as row-eligibility logic.
4. Extract a shared refresh runner only after the outcome policy is explicitly resolved and documented for each mode.
5. Retain diagnostic functions and unused helpers during this change; make deletion a separate decision.

## 7. Validation profile

| Check | Required evidence | Current status |
|---|---|---|
| Structural boundary | Core has no StockAnalysis routes, selectors, data labels, headers or SA_* references. | Planned; no implementation exists yet. |
| Call/reference integrity | All moved functions resolve; no stale helper calls remain. | Planned. |
| Fetch contracts | Test 200, confirmed 404, 429, other non-200, detected block page and thrown fetch. | Planned. |
| Parser regressions | Financial statements, cash flow, metrics, analyst ratings and forecasts retain output shapes. | Planned; live-site tests excluded. |
| Refresh behavior | Cross empty/non-empty targets with null, false, valid data and NOT_FOUND for every mode. | Blocked on Section 4. |
| Scope audit | No unrelated parser rewrite, output-schema change, rate change or public-name change. | Planned. |
| Apps Script integration | Run in the actual project, including Utils.gs dependencies. | Not run; cannot establish from source text alone. |

## 8. Acceptance boundary

- **[CONCLUSION]** Reusable transport, HTML, cell-cleaning, date and sheet primitives belong in ScrapeCore.gs. StockAnalysis routes, anti-bot detection, selectors, parsing schema, placeholders, dispatch, Upk mapping and public entry points belong in StockAnalysis.gs.
- **[CONCLUSION]** The refresh runner remains deferred until the observed result-policy divergence is dispositioned. The Jdg scope defect must also be fixed during implementation.
- **[STATUS] PROPOSED.** This is a design proposal, not executable replacement code. Structural, parser-regression and Apps Script integration checks have not been run. No independent reviewer acceptance is implied.
