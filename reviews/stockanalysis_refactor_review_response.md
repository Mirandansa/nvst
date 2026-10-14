---
artifact_id: stockanalysis_scraper_review_response
version: 0.1
status: PROPOSED
artifact_type: review-response
target_artifact: stockanalysis_scraper_refactor_proposal@0.1
review_round: 2
review_intake:
  reviewers: [reviewer-DS, reviewer-GLM]
  closure_basis: "Both supplied review records are included in this response batch."
source_basis:
  source_file: "Pasted markdown(1).md"
  protocol_file: "project_work_protocol_compact(1).md"
  source_sha256: "author-attested in prior proposal; not independently recomputed by reviewers"
---

# Review response: StockAnalysis scraper refactor

## 1. Decision

- **[CONCLUSION]** Accept the reviewers' factual corrections and design requirements.
- **[STATUS] PROPOSED.** This response does not claim implementation acceptance. The reviewers' requested executable successor and validation evidence remain outstanding; the prior proposal is not accepted by this response.
- **[SCOPE]** No public entry-point names, data-envelope schema, parser semantics, or refresh outcomes are approved for change except the explicit correction of the Jdg scope defect. Any other behavior change requires separate approval.

## 2. Finding disposition ledger

| Finding ID | Disposition | Response / required change | Status |
|---|---|---|---|
| DS-refresh-policy-contract | APPLY | Define a shared runner with declarative policies for transient failure, confirmed 404, empty existing target, eligibility, and refresh-due predicate. Keep each legacy driver's observed outcome policy distinct; do not normalize outcomes silently. | OPEN — implementation and matrix test absent |
| DS-core-predicate-injection | APPLY | Pass the refresh-due predicate into the runner. ScrapeCore must not reference _needsRefresh_ or Utils.gs globals. | OPEN — implementation and grep evidence absent |
| DS-equivalence-test-plan | APPLY | Pin representative HTML fixtures, record SHA-256 for each, run old and new parsers against identical fixtures, and compare serialized JSON byte-for-byte. No equivalence claim without a zero-diff report. | OPEN — harness and fixtures absent |
| GLM-01-matrix-factual-errors | APPLY | Correct driver attribution: refreshSA_ invokes _saRefreshTicker_; refreshSA_Nly/Frc/Icm/Bal/Flo/Kpi invoke _refreshSA_Page_. Split force-path null and thrown-exception outcomes: null writes an empty envelope; a thrown exception is caught and leaves the target unchanged. | OPEN — code-level successor absent |
| GLM-02-404-sentinel-dataset-asymmetry | APPLY | Record behavior per dataset. SA_Icm, SA_Bal, and SA_Flo explicitly test/propagate SA_NOT_FOUND; SA_Nly, SA_Frc, and SA_Kpi do not, so the truthy sentinel reaches _saElements_ and causes TypeError, which the driver catches as a thrown failure. Corrected implementation must explicitly handle the sentinel before parsing for all datasets; this is a behavior correction and must be called out rather than described as legacy equivalence. | OPEN — behavior change needs explicit implementation and tests |
| GLM-03-false-return-dead-path | APPLY | No supplied dataset parser returns false; driver branches are defensive/dead paths on the inspected source. Retain them in this refactor; removal is a separate cleanup. | RESOLVED IN THIS RESPONSE |
| GLM-04-core-parameterization-gaps | APPLY | Make fetch log prefixes and User-Agent configurable options, retaining current StockAnalysis values at the adapter call site. Parameterize the accepted currency-symbol set or explicitly define it as generic core behavior; default is to parameterize it. | OPEN — implementation absent |
| GLM-05-site-vs-workbook-config-conflation | APPLY | Distinguish site configuration (SA_DOM, routes, anti-bot detection) from workbook integration configuration (SA_SHEET_NAME, headers and Jdg gate). Both remain in StockAnalysis.gs. | RESOLVED IN THIS RESPONSE |
| GLM-06-mapping-default-rule-unstated | APPLY | Default rule: any symbol not explicitly assigned to ScrapeCore.gs remains in StockAnalysis.gs. Keep _saRefreshTicker_, _refreshSA_Page_, and _forceRefreshSA_Page_ in the adapter as policy wrappers around the generic runner. | RESOLVED IN THIS RESPONSE |
| GLM-07-divergence-inventory-incomplete | APPLY | Include timing and write strategy in the runner-policy inventory: 300 ms delay in refreshSA_ inner loop and force refresh; 800 ms base delay in per-page refresh; row cap, time budget, periodic flush and batch writes only in per-page refresh; per-cell writes in other paths. Preserve these differences through explicit configuration unless separately approved. | OPEN — policy implementation absent |
| GLM-08-namespace-collision-audit-missing | APPLY | Add a project-wide collision audit for ScrapeCore and relocated names. Intended dependency order: Utils.gs → ScrapeCore.gs → StockAnalysis.gs; _needsRefresh_ remains an injected external dependency of the runner caller, never a core global. Apps Script does not guarantee file-order-based symbol isolation; the order is a maintenance convention, not a scoping mechanism. | OPEN — project-wide source unavailable |
| GLM-09-provenance-limits | APPLY | Label the source digest as author-attested unless independently recomputed from the exact source bytes. Cite source functions by name where pasted line numbers cannot be independently pinned. | RESOLVED IN THIS RESPONSE |
| GLM-10-deliverable-scope | APPLY | The successor deliverable must include actual .gs implementation, not another design-only proposal. It must incorporate the corrections above and keep the shared-runner policy explicit. | OPEN — implementation not included in this response |

## 3. Corrected refresh outcome record

The following is the minimum legacy behavior record supported by the review evidence. It is not a substitute for executable tests.

| Driver | Dataset/parser behavior | null | thrown exception | false | valid data | NOT_FOUND |
|---|---|---|---|---|---|---|
| refreshSA_ → _saRefreshTicker_ | All datasets; Nly/Frc/Kpi may throw on sentinel in _saElements_ | Writes empty envelope | Parser exception is caught and treated as null; writes empty envelope | Writes empty envelope | Writes data envelope | Icm/Bal/Flo propagate sentinel into ordinary-data path; Nly/Frc/Kpi throw before driver sees sentinel |
| refreshSA_{Page} → _refreshSA_Page_ | Icm/Bal/Flo explicitly propagate sentinel; Nly/Frc/Kpi may throw on sentinel | Preserves non-empty target; writes empty envelope only if target was empty | Same as null, because exception is caught and assigned null | Preserves non-empty target; writes empty envelope only if target was empty | Writes data envelope | Writes empty envelope when sentinel reaches driver; parser exceptions for Nly/Frc/Kpi follow transient-failure path |
| forceRefreshSA_{Page} → _forceRefreshSA_Page_ | Icm/Bal/Flo explicitly propagate sentinel; Nly/Frc/Kpi may throw on sentinel | Writes empty envelope | Catches exception and leaves target unchanged | Logs and leaves target unchanged | Writes data envelope | Icm/Bal/Flo sentinel falls through to data serialization; Nly/Frc/Kpi throw before driver sees sentinel |
| _saComputeRefresh_ | Appears unused in supplied source | Returns __SKIP__ | Not established here | Returns __SKIP__ | Returns computed result per implementation | Not established here |

- **[FACT, reviewer-inspected]** No dataset parser in the supplied source returns false; retain defensive branches pending separate cleanup.
- **[BLOCKING]** The post-refactor policy must distinguish legacy-equivalence mode from the explicit NOT_FOUND correction. Handling NOT_FOUND consistently before parser invocation changes observed Nly/Frc/Kpi behavior from a caught TypeError to a confirmed-not-found result. Do not describe that correction as byte-for-byte legacy equivalence.
- **[BLOCKING]** This matrix is based on static review. It has not been executed and must be checked against the actual source and tests before code acceptance.

## 4. Required implementation contract

- ScrapeCore contains only reusable HTML, fetch, value-cleaning, date, sheet-column, and refresh-loop mechanics.
- ScrapeCore.fetchHtml(url, options) receives blockDetector, userAgent, and log-prefix options. The adapter supplies the current StockAnalysis detector, Mozilla/5.0, and exact existing log prefixes.
- ScrapeCore.cleanCell(text, options) receives placeholder values and the currency-symbol configuration.
- The runner receives needsRefresh, eligibilityPredicate, sheet/column accessors, dataset function, runtime limits, sleep intervals, write/flush strategy, and a RefreshPolicy.
- The policy explicitly models transient failure, confirmed not-found, empty-existing-target behavior, and whether exceptions are treated as transient or left unchanged. It must not collapse null and thrown exceptions where legacy paths differ.
- _saJdgNonEmpty_ must be moved to adapter scope or passed as a callback. The Icm gate remains adapter-specific.
- Public entry points and the {date_fetched, data} envelope remain unchanged.
- No parser-equivalence acceptance without pinned fixtures, SHA-256 values, and a zero-diff report. Any approved NOT_FOUND correction is reported separately from equivalence results.

## 5. Validation gates

| Gate | Evidence required | Status |
|---|---|---|
| Source provenance | Exact source bytes and independently computed digest, or explicit author-attested status | PENDING |
| Core boundary | Static scan: no StockAnalysis routes, selectors, labels, SA_* names, or Utils.gs dependencies in ScrapeCore.gs | PENDING |
| Symbol collision | Project-wide inventory of .gs global declarations, including Utils.gs and other fetchers | PENDING — those project files were not supplied for inspection |
| Legacy outcome matrix | Table-driven tests across driver × dataset × result category × empty/non-empty target | PENDING |
| Corrected 404 behavior | Explicit tests showing all six dataset paths classify confirmed 404 before HTML parsing | PENDING |
| Parser equivalence | Pinned fixtures, fixture SHA-256 values, byte-identical JSON diff report | PENDING |
| Runtime behavior | Tests for row cap, time budget, batch/per-cell writes, flush cadence and delays | PENDING |
| Apps Script integration | Execution in actual Apps Script project with Utils.gs and spreadsheet APIs | PENDING |

## 6. Author-side conclusion

- **[CONCLUSION]** Apply all reviewer corrections listed above; no finding is rejected.
- **[STATUS] PROPOSED.** This response resolves textual dispositions but does not satisfy GLM-10's executable-code requirement or the blocking validation gates. It is not an implementation release and does not claim reviewer acceptance.