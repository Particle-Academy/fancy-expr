# Changelog

All notable changes to this package are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

This package is pre-1.0: **breaking changes land in MINOR releases**, so the
version number is not a compatibility promise until 1.0. Every breaking entry
says what a consumer has to DO, not merely what moved.

## [Unreleased]

### Added

- **The Python implementation** (`fancy_expr`), the third and last, written
  against the published rows and `GRAMMAR.md` rather than against either
  sibling. It passes **48 of 48** with nothing skipped — including `0904`,
  the row PHP cannot express.

- **`references(expression)` — what an expression READS**, in all three
  runtimes. The root identifiers it needs, unique and sorted, answered with no
  data and no evaluation. A malformed expression throws exactly as `parse` does.

  This is the second half of *"a node that cannot fire correctly can never be
  saved"*. `parse` catches an expression that is not **syntax**; `references`
  catches one that is valid syntax **reading a name that will never exist**.

  It came from a field report: `{{ $now }}` rendered as nothing, because a `$`
  root reads to an author as *engine-provided* and agents reach for `$now` /
  `$today` / `$index` the way they reach for the ones that exist. A real
  document shipped titled `"Deal List Export -"` with the date silently
  missing. The reporter's own framing is the one that made this possible — an
  unknown `$` root is detectable at PARSE time in a way `in.genuinely_absent`
  is not.

  **The allowlist is the host's, never this package's.** `$json`, `$input` and
  `$props` are real in one host and meaningless in another, so a list here would
  be wrong for every consumer but one:

  ```ts
  const unknown = references(expr).filter((r) => !provided.has(r));
  if (unknown.length) throw new Error(`No such value: ${unknown.join(", ")}`);
  ```

  The same list also refuses a node id that is not a direct predecessor, which
  was the second reported shape. It deliberately cannot catch `in.output` — a
  real root with a field that node never emits — and the suite manifest says so.

- **CI, with all three suites as required jobs** plus `ruff` and `mypy --strict`
  on the Python side. A language whose suite does not run is a language whose
  agreement with the other two is a claim rather than a test result.

- **The PHP implementation** (`FancyExpr\Expr`), written against the published
  `expr/evaluate` conformance rows rather than against the TypeScript source.
  Same grammar, same table, same verdicts.

- **`.length`**, the one pseudo-property, on arrays and strings. It is
  load-bearing rather than convenient: `[]` is truthy in this grammar, so
  without `.length` there would be no way to ask whether a collection is
  *empty*. Objects deliberately have none.

### Fixed

- **`py.typed` was missing**, while `pyproject.toml` declared
  `Typing :: Typed`. Metadata claiming something the wheel did not back: a
  consumer running mypy against the installed package got
  `cannot be type checked due to missing py.typed marker` and **no type
  information at all**, from a package advertising it.

  Six of the kit's eight Python packages ship the marker. The two that did not
  are `fancy-conformance` and `fancy-expr` — the only two where Python lives in
  `python/` rather than at the repository root. The same polyglot blind spot
  that hid the PyPI gap, one layer down.

  It passed locally because `mypy_path = src` type-checks the SOURCE. Only CI,
  running against the installed package, asked the question a consumer asks.

- **`GRAMMAR.md`'s EBNF was missing the `multiplicative` production entirely**,
  while both shipped implementations parsed `*` and `/` and conformance row
  `0704` (`(1 + 2) * 1 === 3`) requires them.

  This is the more dangerous of the two spec-versus-code contradictions this
  package has had, and it points the wrong way: a port written faithfully from
  the specification alone would have rejected a valid expression and failed the
  table, with the **table right and the specification wrong**. Found while
  starting the Python port, which is exactly when it would have bitten.

  The arithmetic section now also states `/` by zero yielding `null` (infinity
  cannot survive the JSON round trip these expressions live in) and a comparison
  with an absent operand yielding `false` rather than an error.

### Changed

- **`composer.json` moved from `php/` to the repository root**, with `psr-4`
  pointing into `php/src/`. Packagist reads only the root manifest, so the
  subdirectory version would have been invisible to it — the package would have
  been unfindable while looking correct in the tree. This matches the
  `fancy-conformance` polyglot layout.

  *Consumer action: none.* Nothing was published from the old layout.

### Security

- **`esbuild` forced to `^0.28.1` via an npm `override`** (GHSA-g7r4-m6w7-qqqr,
  low). `tsup@8.5.1` still declares `esbuild: ^0.27.0`, so the real fix — the
  dependency that pulls it shipping a patched range — does not exist upstream
  yet. Eight sibling repos in the kit carry the identical override for the same
  reason; all of them drop it the moment tsup ships `esbuild >=0.28.1`.

  Build-time only, and `npm ls esbuild` reports `0.28.2 overridden`.

  *Consumer action: none.* `esbuild` is not in this package's dependency tree —
  it only builds the tarball.

### Notes

The PHP port failed **exactly one row** on its first run — `0904`, that an
object has no `.length` — and the row, not the port, turned out to describe the
limit: `json_decode('{}', true)` and `json_decode('[]', true)` produce the
identical value in PHP and `array_is_list()` calls both a list, so an *empty*
object is not distinguishable from an empty array. Skipped for PHP with the
reason attached, and `0906` now pins the same rule with a non-empty object that
all three languages can express. That is the spec-first order doing the job it
was adopted for.

## [0.1.0] - 2026-08-25

### Added

- `GRAMMAR.md` — the specification, published **before** any implementation.
- The TypeScript implementation: tokenizer, parser and evaluator, plus
  `parse()` separable from `evaluate()` so a host can ask *"is this expression
  valid?"* with no data — which is what makes a node carrying a broken
  expression rejectable at **save** time rather than discovered mid-run.
- Discrimination tests covering the three semantics a plausible-but-wrong port
  would get wrong: native truthiness, coercing equality, and `&&`/`||`
  returning booleans instead of the operand.

[Unreleased]: https://github.com/Particle-Academy/fancy-expr/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Particle-Academy/fancy-expr/releases/tag/v0.1.0
