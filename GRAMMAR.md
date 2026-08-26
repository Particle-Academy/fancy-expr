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
additive     := unary ( ( "+" | "-" ) unary )*
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
equality, comparison, `+ -`, unary, primary.

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

### Equality

`==` and `===` are the SAME operator, and so are `!=` and `!==`. Both spellings
are accepted because authors write both; neither performs type coercion.

There is no loose equality in this grammar. `"1" == 1` is `false`. A language
with two equality operators that differ subtly is a language that generates
bug reports, and we have three runtimes to keep in step.

### Numbers

One numeric type, IEEE-754 double, matching JSON. `+` on two numbers adds; `+`
where either side is a string concatenates; `-` is numeric only.

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

## Why hand-written rather than a library

Because `symfony/expression-language`, `expr-eval` and `simpleeval` are all
real, current, and **do not agree with each other** on the table above. Adopting
them would ship three subtly different languages under one syntax, and we would
own neither side of the divergence. One grammar written three times against a
shared fixture table is the only version of this that can be held to a contract.
