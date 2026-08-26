/**
 * fancy-expr — a sandboxed expression evaluator.
 *
 * One grammar, three implementations. `GRAMMAR.md` is the specification and
 * this is one of its three readers; the others are `particle-academy/fancy-expr`
 * (PHP) and `fancy-expr` (PyPI). All three assert the same rows from
 * `expr/evaluate` in `@particle-academy/fancy-conformance`.
 *
 * ```ts
 * import { evaluate, parse } from "@particle-academy/fancy-expr";
 *
 * evaluate("in.transcript || in.content", { in: { content: "hi" } });  // "hi"
 * parse("in.a &&");   // throws ExprSyntaxError -- ask this at SAVE time
 * ```
 *
 * An unresolved path is `null`. A malformed expression THROWS. Those never
 * being the same value is the reason this package exists.
 */
export { evaluate, evaluateNode, truthy, parse, ExprSyntaxError, type Node } from "./evaluate";
