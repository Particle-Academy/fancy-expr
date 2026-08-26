# fancy-expr

A sandboxed expression evaluator with **one grammar and three implementations**
— TypeScript, PHP and Python — all asserted against the same fixture table.

```ts
import { evaluate, parse } from "@particle-academy/fancy-expr";

evaluate("in.transcript || in.content", { in: { content: "hi" } });  // "hi"
evaluate("results.length === 0 ? 'none' : 'ok'", { results: [] });   // "none"

parse("in.a &&");   // throws — ask this at SAVE time, before a run
```

## The one thing to know

**An unresolved path is `null`. A malformed expression THROWS.** Those are never
the same value.

That distinction is the entire reason this package exists. Its absence cost a
consumer a production workflow: a branch condition the engine could not evaluate
returned `null`, `null` read as `false`, and the graph took the wrong road on
every run — while reporting success, with no error and no log line.

## What it is not

Not a programming language. No user functions, no loops, no assignment, no
method calls, no property access on host objects, no `eval` in any
implementation. Expressions arrive from end users and from agents, over the
wire; the sandbox is a security boundary rather than a style preference.

## Why not an existing library

`symfony/expression-language`, `expr-eval` and `simpleeval` are all real,
current, and the standard answer in their language. They also **disagree with
each other** on truthiness, equality and coercion.

Adopting them would ship three subtly different languages under one syntax, and
we would own neither side of the divergence. One grammar written three times
against a shared fixture table is the only version that can be held to a
contract.

## Read next

**[`GRAMMAR.md`](./GRAMMAR.md)** is the specification — the implementations
follow it, not each other. It states the rules three languages would otherwise
drift on: `[]` and `{}` are truthy, `==` and `===` are the same operator,
`&&`/`||` return the operand rather than a boolean, and `.length` is the one
pseudo-property.
