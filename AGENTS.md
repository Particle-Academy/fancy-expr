# AGENTS.md — fancy-expr

A sandboxed expression evaluator: **one grammar, three implementations**
(TypeScript, PHP, Python), shipped from one repo the way `fancy-conformance` is.
`CLAUDE.md` symlinks here.

This file describes **this repo's code**. Process rules — publishing, kit
versioning, backports — live in the envelope's `AGENTS.md` and are deliberately
not repeated.

## Read GRAMMAR.md first

`GRAMMAR.md` is the specification. The implementations follow it; they do not
follow each other, and none of them is "the reference" in the sense of being
allowed to define behaviour by accident. A disagreement between an
implementation and the grammar is a bug in the implementation.

## Why this exists

`fancy-flow`'s `{{ … }}` resolved dot-paths only and returned `null` for
everything else — the same `null` a real-but-absent path returns. The two were
indistinguishable, so a condition the engine could not evaluate silently read as
`false`, a graph took the wrong branch on every run, and the run reported
success. A consumer lost a production workflow to exactly that, and found it only
by reading the resolver's source.

So there are two jobs here, and the second matters as much as the first:

1. Make the shapes people actually write **evaluate**.
2. Make the ones that cannot **say so**, loudly, and ideally at save time.

## Why not a library

`symfony/expression-language`, `expr-eval` and `simpleeval` are all real, current
and the standard answer in their language. They also **do not agree with each
other** on truthiness, equality or coercion. Adopting them would ship three
subtly different languages under one syntax, and we would own neither side of
the divergence — which is the failure `fancy-conformance` exists to catch and
would be powerless to fix. One grammar written three times against a shared
fixture table is the only version that can be held to a contract.

## Invariants

**Absence and malformity are DIFFERENT OUTCOMES.** An unresolved path is `null`.
A malformed expression **throws**. Collapsing them is the original defect; any
change that lets a parse failure return `null` reintroduces it.

**Parsing is separable from evaluation.** A host must be able to ask "is this
expression valid?" with no data at all — that is what makes a node with a broken
expression rejectable at save time rather than discovered mid-run.

**No host reach, in any implementation.** No `eval`, no `exec`, no property
access on host objects, no method calls, no imports, no assignment. Expressions
arrive from end users and from agents, over the wire. This is a security
boundary, not a style preference.

**`[]` and `{}` are TRUTHY**, against PHP's and Python's native instincts. The
data came from JSON; an array that exists is a value. Testing whether it is empty
is what `.length` is for, and conflating the two turns "did we get results?" into
"did the call succeed?".

**`==` and `===` are the same operator.** No loose equality anywhere. Two
equality operators that differ subtly is a language that generates bug reports,
and there are three runtimes to keep in step.

## Layout

One repo, three languages, mirroring `fancy-conformance`:

```
GRAMMAR.md         the specification -- read it first
src/               TypeScript
tests/
php/src/           PHP
php/tests/
composer.json      AT THE ROOT, psr-4 -> php/src/
phpunit.xml        AT THE ROOT, testsuite -> php/tests
```

**`composer.json` belongs at the repository root and nowhere else.** Packagist
reads only the root manifest; one inside `php/` is invisible to it, so the
package would be unpublishable while looking perfectly organised in the tree.
This repo had it in `php/` for exactly one afternoon.

## Testing

```bash
npm test                      # TypeScript: table + discrimination probes
php vendor/bin/pest           # PHP: the same table, plus PHP-specific probes
```

Every semantic rule in `GRAMMAR.md` is a row in the shared corpus, and each
implementation runs the same rows. Add the row FIRST, then satisfy it in all
three — the spec-first order, which repeatedly caught real defects in the flow
runtimes when the table predated the port.

It earned its keep here on the first independent port. The PHP implementation
was written against the published rows rather than against `src/`, and failed
**exactly one** of 44 on its first run: `0904`, that an object has no `.length`.
The row was right and the port was right — PHP simply cannot express the case,
because `json_decode('{}', true)` and `json_decode('[]', true)` produce the
identical value and `array_is_list()` calls both a list. Skipped for PHP with
the reason attached; `0906` pins the same rule with a non-empty object, which
every language can express.

Discrimination probes are required, not optional: a deliberately-wrong evaluator
must fail an EXACT set of case ids. A table every plausible implementation passes
proves nothing. Each language's probes should aim at **that language's own
instincts** — PHP's are `(bool) []`, `'3' == 3` and `'0'`.

A full mutant harness (deliberately-wrong evaluators failing an exact id set,
the way `shared/decimal` has) is still owed, and is recorded in the suite's
manifest so the current green tick is not read as the stronger claim.

## Status

**TypeScript and PHP implemented and green. Python is not written yet.**

Registered in `PackageRegistry::PLANNED`. **Nothing is published, and none of
the three registry names exist** — npm, Packagist and PyPI all need a first
publish, and each bootstraps differently. Read the envelope's
`.ai/knowledge/publishing.md` and run `.claude/skills/ship-it/preflight.py`
before attempting one; do not improvise the sequence.
