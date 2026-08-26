# Changelog

All notable changes to this package are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

This package is pre-1.0: **breaking changes land in MINOR releases**, so the
version number is not a compatibility promise until 1.0. Every breaking entry
says what a consumer has to DO, not merely what moved.

## [Unreleased]

### Added

- **The PHP implementation** (`FancyExpr\Expr`), written against the published
  `expr/evaluate` conformance rows rather than against the TypeScript source.
  Same grammar, same table, same verdicts.
- **`.length`**, the one pseudo-property, on arrays and strings. It is
  load-bearing rather than convenient: `[]` is truthy in this grammar, so
  without `.length` there would be no way to ask whether a collection is
  *empty*. Objects deliberately have none.

### Changed

- **`composer.json` moved from `php/` to the repository root**, with `psr-4`
  pointing into `php/src/`. Packagist reads only the root manifest, so the
  subdirectory version would have been invisible to it — the package would have
  been unfindable while looking correct in the tree. This matches the
  `fancy-conformance` polyglot layout.

  *Consumer action: none.* Nothing was published from the old layout.

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
