# StockAnalysis scraper refactor — implementation submission

```yaml
artifact: stockanalysis_scraper_refactor_implementation
version: "0.3"
status: PROPOSED
protocol: project_work_protocol_compact_v1.1
review_round: 4
implementation:
  ScrapeCore.gs:
    raw_source_path: src/ScrapeCore.gs
    verified_line_count: 283
    complete: true
    exposes:
      - runRefresh
      - cleanCell
      - elements
      - innerHtml
      - cells
      - openingTag
      - text
      - attr
      - hasClass
      - parseDate
      - findColumn
      - fetchHtml
      - NOT_FOUND
  StockAnalysis.gs:
    raw_source_path: src/StockAnalysis.gs
    forecast_heading_regex_fixed: true
    legacy_404_asymmetry_preserved: true
  refresh_runner_contract:
    signature: runRefresh(options)
    injected_callbacks:
      - eligibilityPredicate
      - needsRefresh
      - fetch
      - write
      - flush
      - sleepAfter
    runtime_options:
      - rows
      - maxRows
      - timeBudgetMs
      - flushEvery
      - sleepMs
      - policy
    event_callbacks:
      - onSelection
      - onCapped
      - onTimeBudget
      - onException
      - onFalse
    policy_keys:
      - onTransientFailure
      - onEmptyExistingTransient
      - onException
      - onFalse
      - onNotFound
validation:
  node_syntax_checks: PASSED
  local_test_count: 223
  local_test_failures: 0
  harness_prints_sha256_for_loaded_core_and_adapter: true
  runner_policy_matrix: PASSED
  adapter_symbol_contract: PASSED
  core_boundary_scan: PASSED
  forecast_heading_regression: PASSED
  pinned_html_fixture_differential: BLOCKED
  Apps_Script_runtime: NOT_RUN
  Utils_gs_dependency_review: BLOCKED
  project_wide_collision_audit: BLOCKED
acceptance: pending_independent_review
```

## Raw source files

- ScrapeCore.gs: https://raw.githubusercontent.com/Mirandansa/nvst/stockanalysis-refactor-implementation-v0.3-2026-10-14/src/ScrapeCore.gs
- StockAnalysis.gs: https://raw.githubusercontent.com/Mirandansa/nvst/stockanalysis-refactor-implementation-v0.3-2026-10-14/src/StockAnalysis.gs
- Test harness: https://raw.githubusercontent.com/Mirandansa/nvst/stockanalysis-refactor-implementation-v0.3-2026-10-14/tests/test_refactor.js

## Corrections in this revision

- Restored the forecast heading/table regex closing-tag backreference. The expression now uses the literal word-boundary escape and a closing-tag backreference, rather than control characters.
- Added a regression check that associates both “Revenue Forecast” and “EPS Forecast” headings with their matching tables.
- Added static checks proving every ScrapeCore symbol used by the adapter is exported and that the core has no _needsRefresh_, _saJdgNonEmpty_, SA_* or Jdg references.
- Added observable runner-contract checks for due-state selection, eligibility, row caps, callbacks, writes, time-budget termination, periodic/final flushing, sleep gating and policy outcomes.
- The harness emits SHA-256 values for the exact source strings it loads. The recorded values below are from the delivered branch contents.

## Validation details

- Node syntax checks passed for the core and adapter after copying the .gs files to temporary .js paths; Node does not accept .gs as a direct --check filename.
- The local harness completed with no failed checks. The authoritative count is recorded once in the YAML header and derives from the harness output.
- The harness uses synthetic fixtures. No pinned real StockAnalysis HTML fixtures were supplied, so parser byte-equivalence against the pre-refactor implementation remains blocked.
- No Google Apps Script runtime execution was performed. Utils.gs was not supplied, so _needsRefresh_ could not be independently reviewed. The rest of the project files were also unavailable, preventing a project-wide collision audit.
- The legacy 404 asymmetry remains intentional: SA_Icm, SA_Bal, and SA_Flo return NOT_FOUND; SA_Nly, SA_Frc, and SA_Kpi retain their legacy TypeError path.

## SHA-256

Hashes cover the exact source contents fetched from the delivered branch (UTF-8; no terminal newline is appended by the source endpoint).

| File | SHA-256 |
|---|---|
| ScrapeCore.gs | 5aab37c5d081c9ce4646804f3afa1fb5058a0b39b4b799818b509aa4df7742d0 |
| StockAnalysis.gs | d4808b6a47955af558a79be14a8345983ed204d769b7dedf4cd1f6d2133f54e8 |
| test_refactor.js | 2a2cbb2fcf2c604f984de6f99ea64b634716cfb3370ba81615fff2a2a57d8a59 |

Keep status PROPOSED until pinned-fixture differential tests, Apps Script runtime execution, external dependency review and the project-wide collision audit are completed or explicitly waived by the project owner.
