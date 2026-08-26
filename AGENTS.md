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

## Testing

Every semantic rule in `GRAMMAR.md` is a row in the shared corpus, and each
implementation runs the same rows. Add the row FIRST, then satisfy it in all
three — the spec-first order, which repeatedly caught real defects in the flow
runtimes when the table predated the port.

Discrimination probes are required, not optional: a deliberately-wrong evaluator
must fail an EXACT set of case ids. A table every plausible implementation passes
proves nothing.

## Status

**Not yet implemented.** Registered in `PackageRegistry::PLANNED`, grammar
specified, repo scaffolded. Nothing is published, and the three registry names do
not exist yet — see the envelope's `.ai/knowledge/publishing.md` and
`.claude/skills/ship-it/` before attempting a first publish.
