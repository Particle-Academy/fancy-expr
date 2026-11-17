# Using fancy-expr — guide for agents

How an agent installs and uses this package in a consumer app. What the package
is, is in [README.md](./README.md). Notes for working ON this repo's code are in
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Install

| Runtime | Command |
|---|---|
| TypeScript | `npm i @particle-academy/fancy-expr` (Node `>=22`) |
| PHP | `composer require particle-academy/fancy-expr` (PHP `^8.4`) |
| Python | `pip install fancy-expr` (not on PyPI yet) |

No runtime dependencies in any of the three.

## Find it on the Fancy MCP server

The catalog server is `https://ui.particle.academy/mcp` (streamable HTTP, no API
key; MCP id `fancy-ui`). It is listed as the registry entry `fancy-expr` (a
package entry, not vendorable source). Find it with `search-backend-packages`
(stack `php`, `node` or `python`); `install-instructions` with `fancy-expr`
gives the commands.

## API essentials

The same three questions in every runtime. TypeScript:

```ts
import { evaluate, parse, references } from "@particle-academy/fancy-expr";

evaluate("in.transcript || in.content", { in: { content: "hi" } });  // "hi"
evaluate("results.length === 0 ? 'none' : 'ok'", { results: [] });   // "none"

parse("in.a &&");            // throws ExprSyntaxError — ask this at SAVE time
references("{ when: $now }") // ["$now"] — the root names it reads, sorted
```

- PHP: static methods on `FancyExpr\Expr` (`Expr::evaluate`, `Expr::parse`,
  `Expr::references`, `Expr::truthy`); errors are `FancyExpr\ExprSyntaxError`.
- Python: `from fancy_expr import evaluate, parse, references`; a malformed
  expression raises `ExprSyntaxError`.
- TypeScript also exports `evaluateNode`, `truthy`, `ExprSyntaxError`,
  `MAX_EXPRESSION_BYTES` and `MAX_EXPRESSION_DEPTH`.
- Supported: paths, literals, logic, comparisons, ternaries, object/array
  literals, and `.length` as the one pseudo-property. The full specification is
  [`GRAMMAR.md`](./GRAMMAR.md), which ships in the npm package.

**Cannot fire, cannot save.** Validate at save time with both halves: `parse()`
rejects bad syntax; `references()` lets the host reject names that will never
exist:

```ts
const unknown = references(expr).filter((r) => !provided.has(r));
if (unknown.length) throw new Error(`No such value: ${unknown.join(", ")}`);
```

## Traps

- **An unresolved path is `null` (`None` in Python). A malformed expression
  throws.** Never treat the two as the same outcome.
- **The allowlist is yours.** The package does not know whether `$now`,
  `$json`, `$input` or `$props` exist in your host; check `references()` against
  what you actually provide.
- **`[]` and `{}` are truthy**, unlike PHP and Python natively. Test emptiness
  with `.length`.
- **`==` and `===` are the same operator.** There is no loose equality.
- `&&` / `||` return the operand, not a boolean.
- A bool is not a number: `flag === 1` is false and `true + 1` is `null`
  (Python's `True == 1` instinct does not apply).
- **Not a programming language.** No user functions, loops, assignment, method
  calls, host property access or `eval`. A call does not even parse.
