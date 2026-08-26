# The fancy-expr grammar

One grammar, three implementations (TypeScript, PHP, Python), asserted against a
shared fixture table. This file is the specification; the implementations follow
it, not each other.

## What this is for

`fancy-flow` resolves `{{ … }}` against a run's data. Until now it resolved
**dot-paths only** and returned `null` for anything else — and `null` is also
what a real-but-absent path returns. Those two are indistinguishable, so a
condition the engine could not evaluate silently read as `false` and a graph took
the wrong branch on every run, reporting success. A consumer lost a production
workflow to exactly that.

So this exists to make the common authoring shapes actually evaluate — and, just
as importantly, to make the ones that *cannot* evaluate say so.

## What it deliberately is NOT

**Not a programming language.** No user-defined functions, no loops, no
assignment, no statements, no host property access, no `eval` in any
implementation. An expression takes data in and produces a value; it cannot
reach the machine, the host object graph, or the outside world.

That is a security property, not a style preference: these expressions are
authored by end users and by agents, and they arrive over the wire.

## Grammar

```
expression   := ternary
ternary      := or ( "?" expression ":" expression )?
or           := and ( "||" and )*
and          := equality ( "&&" equality )*
equality     := comparison ( ( "==" | "!=" | "===" | "!==" ) comparison )*
comparison   := additive ( ( "<" | "<=" | ">" | ">=" ) additive )*
additive     := multiplicative ( ( "+" | "-" ) multiplicative )*
multiplicative := unary ( ( "*" | "/" ) unary )*
unary        := ( "!" | "-" )? primary
primary      := literal | path | array | object | "(" expression ")"

literal      := number | string | "true" | "false" | "null"
path         := segment ( ( "." segment ) | ( "[" expression "]" ) )*
segment      := IDENT | "$" IDENT
array        := "[" ( expression ( "," expression )* )? "]"
object       := "{" ( key ":" expression ( "," key ":" expression )* )? "}"
key          := IDENT | string
```

Precedence runs lowest to highest exactly as listed: ternary, `||`, `&&`,
equality, comparison, `+ -`, `* /`, unary, primary.

**The `multiplicative` line was missing from this block until 2026-08-25** — the
second time the spec has contradicted the code in this package, and the worse of
the two. Both shipped implementations parsed `*` and `/`; only the grammar did
not mention them, and conformance row `0704` (`(1 + 2) * 1 === 3`) *requires*
them. So a port written faithfully from this file alone would have rejected a
valid expression and failed the table — with the table right and the
specification wrong, which is the one direction this whole arrangement is not
supposed to allow. Found while starting the Python port.

## Semantics, and where they are pinned

Every rule below is a row in `flow/expr-*` in
`@particle-academy/fancy-conformance`. Where three languages could reasonably
disagree, the table decides and all three obey it.

### Absence is not an error

A path that does not resolve is `null`. That is the ONE null this grammar
produces, and it means *absent*, not *broken*. `{{ user.middle_name }}` on a
record without one is a legitimate `null`, forever.

A **malformed** expression — one that cannot parse — is a different outcome
entirely and never returns `null`. See "Failure" below.

### Truthiness

Deliberately explicit, because this is where three languages differ most and
where a silent disagreement is most expensive.

| value | truthy |
|---|---|
| `null` | false |
| `false` | false |
| `0`, `-0` | false |
| `""` | false |
| `[]` | **true** |
| `{}` | **true** |
| everything else | true |

`[]` and `{}` being **true** is the deliberate choice. PHP's native truthiness
says empty array is false; JavaScript says every object is true; Python says
empty containers are false. We follow JavaScript here because the data being
evaluated arrived as JSON, and a JSON array is a value that exists — testing
whether it is *empty* is what `.length` is for, and conflating the two is how a
"did we get results?" check silently becomes "did the call succeed?".


### `.length`

The one pseudo-property this grammar provides. `.length` on an **array** or a
**string** yields a count; on anything else it is `null`.

It is load-bearing rather than convenient, and the truthiness rule above is why:
`[]` is truthy, so without `.length` a consumer would have **no way to ask
whether a collection is empty** — the grammar would say "an array that exists is
a value" and then leave them unable to test the thing they actually care about.

```
{{ results.length === 0 ? 'nothing found' : 'ok' }}
```

It is not host reach: nothing is called and no prototype is walked, a count is
computed. Objects deliberately have **no** `.length` — there is no answer three
languages would agree on, and an object used as a collection is rare enough not
to justify inventing one.

**This section exists because writing the discrimination tests found the spec
contradicting the implementation.** The truthiness rule was justified with
`.length` while `.length` returned `null` — prose promising something the code
did not do, in a package written the same hour. Recorded rather than quietly
fixed, because it is the exact failure this whole corpus argues against.

### Equality

`==` and `===` are the SAME operator, and so are `!=` and `!==`. Both spellings
are accepted because authors write both; neither performs type coercion.

There is no loose equality in this grammar. `"1" == 1` is `false`. A language
with two equality operators that differ subtly is a language that generates
bug reports, and we have three runtimes to keep in step.

### Arithmetic

One numeric type, IEEE-754 double, matching JSON.

| operator | rule |
|---|---|
| `+` | two numbers add; if **either** side is a string, both are stringified and concatenated; otherwise `null` |
| `-` `*` | numeric only — anything else is `null` |
| `/` | numeric only, **and division by zero is `null`** |
| `<` `<=` `>` `>=` | two numbers, or two strings lexicographically; a mixed or absent operand is **`false`**, not an error |

Two deliberate choices in that table:

**Division by zero is `null`, not `Infinity` and not a throw.** `Infinity` is
not representable in JSON, so returning it would produce a value that cannot
survive the round trip these expressions live inside.

**A comparison with an absent operand is `false`, not a failure.** `{{ x > 5 }}`
where `x` never arrived is a question with no answer, and answering `false` is
survivable in a way that killing the run is not. This is the one place the
grammar prefers a quiet answer — and it is safe only because *malformity* still
throws, so "the author wrote nonsense" and "the data did not arrive" remain
distinguishable.

### Short-circuit

`&&` and `||` short-circuit, and they return the **operand**, not a boolean —
`a || b` yields `a` when `a` is truthy, otherwise `b`. That is what makes
`{{ in.content || in.transcript }}` useful rather than merely true.

## Failure

A malformed expression **throws**, with the offending text and an offset. It does
not return `null`, because that is the whole defect this package exists to
remove.

Callers choose what to do with the throw. `fancy-flow` will fail the node — a
branch that cannot evaluate its condition has not made a decision, and treating
that as `false` is a decision it did not make.

Parsing is separable from evaluation precisely so a host can ask *"is this
expression valid?"* without any data — which is what makes a node with a broken
expression rejectable at **save** time rather than discovered at run time.

## What an expression READS — `references()`

`references(expression)` returns the **root identifiers** an expression needs,
unique and sorted, with no data and no evaluation. A malformed expression throws
exactly as `parse` does.

```ts
references("{ deal: in.deal_id || '', when: $now }")   // ["$now", "in"]
```

**This is the second half of "cannot fire ⇒ cannot save".** `parse` catches an
expression that is not *syntax*; `references` catches one that is valid syntax
reading something that does not exist.

It exists because of a specific failure. `{{ $now }}` rendered as nothing: a
`$`-prefixed root reads to an author as *engine-provided*, so agents reach for
`$now` / `$today` / `$index` the way they reach for the ones that exist, and a
real document shipped titled `"Deal List Export -"` with the date silently
missing. An unknown `$` root **is** detectable statically, in a way that
`in.genuinely_absent` is not — the first is a name that will never exist, the
second is data that may arrive tomorrow.

**The allowlist is the host's, never this package's.** `fancy-expr` cannot know
whether `$now` exists; `$json`, `$input` and `$props` are real in one host and
meaningless in another, so a list here would be wrong for everyone but one
consumer. So it answers only what it can answer honestly, and the host decides:

```ts
const unknown = references(expr).filter((r) => !provided.has(r));
if (unknown.length) throw new Error(`No such value: ${unknown.join(", ")}`);
```

The same list refuses a node id that is not a direct predecessor, which was the
second reported shape.

Three rules, each pinned in `expr/references`:

| | |
|---|---|
| Object literal **keys** are not references | `{ transcript: in.content }` reads `in`. Reporting `transcript` makes a host reject a valid expression, and the author cannot comply — the worse direction of wrong. |
| **Both** branches of a ternary are read | A static question has no run. Reusing the evaluator's short-circuit approves an expression that fails on the other road. |
| A **computed index** is a reference | `items[i]` reads `i`. An implementation walking only `.name` steps passes everything else. |

**It cannot catch `in.output`** — a real root with a field that node never
emits. The root is legitimate, so nothing static separates a field that is
absent from one absent *this run*. That is the boundary, and it is stated rather
than left to be discovered.

## Why hand-written rather than a library

Because `symfony/expression-language`, `expr-eval` and `simpleeval` are all
real, current, and **do not agree with each other** on the table above. Adopting
them would ship three subtly different languages under one syntax, and we would
own neither side of the divergence. One grammar written three times against a
shared fixture table is the only version of this that can be held to a contract.
