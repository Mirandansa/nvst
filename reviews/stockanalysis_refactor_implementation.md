# StockAnalysis scraper refactor — implementation submission

```yaml
artifact: stockanalysis_scraper_refactor_implementation
version: 0.2
status: PROPOSED
protocol: project_work_protocol_compact_v1.1
review_scope: DS round 2; GLM round 2
implementation:
  shared_refresh_runner: implemented
  adapter_core_split: implemented
  legacy_outcome_policies: encoded_per_driver
validation:
  node_syntax_checks: passed
  local_test_harness: passed
  local_test_count: 68
  pinned_html_fixture_differential: BLOCKED
  Apps_Script_runtime: NOT_RUN
  Utils_gs_dependency_review: BLOCKED
  project_wide_collision_audit: BLOCKED
acceptance: pending_independent_review
```

## Submission files

- `ScrapeCore.gs`: https://raw.githubusercontent.com/Mirandansa/nvst/stockanalysis-refactor-implementation-2026-10-14/src/ScrapeCore.gs
- `StockAnalysis.gs`: https://raw.githubusercontent.com/Mirandansa/nvst/stockanalysis-refactor-implementation-2026-10-14/src/StockAnalysis.gs
- `test_refactor.js`: https://raw.githubusercontent.com/Mirandansa/nvst/stockanalysis-refactor-implementation-2026-10-14/tests/test_refactor.js

## Implementation summary

`ScrapeCore.gs` now owns reusable HTML/HTTP helpers, cell/date helpers, and `ScrapeCore.runRefresh`. The runner receives callbacks for row eligibility, refresh due-state, fetch behavior, writes/flushes and logging; runtime limits and row delays are parameters. It has no references to `_needsRefresh_`, `_saJdgNonEmpty_`, `SA_*` names, or `Jdg`.

`StockAnalysis.gs` retains the site-specific URL construction, block detection, user agent/log prefix, currency symbols and placeholders, parsers, dataset functions, workbook sheet/column configuration and public entrypoints. `_saJdgNonEmpty_` is now top-level so all three refresh paths can call it. `_saRefreshTicker_`, `_refreshSA_Page_`, and `_forceRefreshSA_Page_` delegate their iteration and outcome handling to the shared runner with distinct policies.

### Encoded outcome policies

| Driver | Transient null | Empty-target null | Thrown exception | `false` | `NOT_FOUND` |
|---|---|---|---|---|---|
| Ticker (`_saRefreshTicker_`) | overwrite with empty envelope | overwrite with empty envelope | overwrite with empty envelope | overwrite with empty envelope | serialize sentinel as data |
| Per-page (`_refreshSA_Page_`) | preserve existing | overwrite with empty envelope | preserve existing or write empty envelope | preserve existing or write empty envelope | overwrite with empty envelope |
| Force (`_forceRefreshSA_Page_`) | overwrite with empty envelope | overwrite with empty envelope | preserve existing | preserve existing | serialize sentinel as data |

The implementation deliberately keeps the existing dataset 404 asymmetry: `SA_Icm`, `SA_Bal`, and `SA_Flo` return the sentinel; `SA_Nly`, `SA_Frc`, and `SA_Kpi` retain their parser TypeError path when the sentinel reaches string parsing. Uniform 404 handling is not silently introduced as a behavior change.

The per-page runner retains the 200-row cap, 5-minute budget, 20-row periodic flush and 800-ms spacing. The ticker and force paths keep their 300-ms spacing and per-cell writes. The force path preserves the legacy no-sleep continuation after `null` and `false` results.

## Validation evidence

Executed locally against the refactored files using Node.js (a harness, not the Apps Script runtime):

- `node --check` on both `.gs` files after copying to temporary `.js` files: passed.
- `node test_refactor.js`: **218 checks passed; 0 failed**.
- The harness tests generic helpers, HTTP/result mapping, the three-driver × five-result × two-target-state core policy matrix and the three-driver × six-dataset × five-result × two-target-state adapter-wrapper matrix, Icm eligibility in all refresh paths, row caps/flush/sleep behavior, public entrypoints, and the legacy dataset-specific 404 parser behavior.
- Static dependency scan of `ScrapeCore.gs` for `_needsRefresh_`, `_saJdgNonEmpty_`, `SA_*` symbols and `Jdg`: zero matches.

## Explicit limitations / blocked acceptance gates

- No pinned live/historical StockAnalysis HTML fixtures were present in the provided materials. Therefore this submission does **not** claim byte-identical parser output against the pre-refactor parser. The required fixture/SHA-256 differential report remains blocked until the fixtures can be supplied or captured under an approved network-enabled test setup.
- `Utils.gs` was not supplied. `_needsRefresh_` is deliberately dependency-injected as an external adapter callback, but its original implementation and behavior have not been independently reviewed.
- The remaining project files were not supplied; the project-wide symbol collision audit is incomplete.
- No Google Apps Script deployment/runtime execution or live StockAnalysis request was performed.
- The 218 checks are local synthetic/unit and adapter-wrapper tests. They are not a substitute for the blocked differential parser fixture gate or Apps Script runtime validation.

## SHA-256

Hashes are computed over the exact UTF-8 file contents fetched from the submitted GitHub branch.

| File | SHA-256 |
|---|---|
| `ScrapeCore.gs` | `5aab37c5d081c9ce4646804f3afa1fb5058a0b39b4b799818b509aa4df7742d0` |
| `StockAnalysis.gs` | `6b80f62d21d1d7324a0024689e8e13f67e18de725716e39fbac13016a593c21f` |
| `test_refactor.js` | `e1cf40c2d2b62765b8f924ce210fb4f28438f4c90a12caaed3c17aeed13b3777` |

## Decision requested

Review the implementation for design and behavioral equivalence. Keep status `PROPOSED` until the blocked fixture differential, external dependency review and runtime gates have been addressed or explicitly waived by the project owner. No claim of final acceptance is made here.