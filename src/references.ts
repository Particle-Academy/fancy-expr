import { parse, type Node } from "./parse";

/**
 * The ROOT identifiers an expression reads — unique, sorted, and answered
 * without any data at all.
 *
 * ## Why this exists
 *
 * A consumer reported that `{{ $now }}` renders as nothing. `$`-prefixed roots
 * read to an author as *engine-provided*, so agents reach for `$now`, `$today`
 * and `$index` the way they reach for the two that actually exist — and a real
 * document shipped titled `"Deal List Export -"` with the date silently
 * missing. Their observation, which is the one that matters: an unknown `$`
 * root is detectable at PARSE time in a way `in.genuinely_absent is not`.
 *
 * ## Why the check does not live in here
 *
 * This package cannot know whether `$now` exists. `$json`, `$input` and
 * `$props` are real in one host and meaningless in another, so an allowlist
 * here would be wrong for every host but one. So it answers the only question
 * it can answer honestly — *what does this expression read?* — and the host
 * compares that against what it actually provides:
 *
 * ```ts
 * const unknown = references(expr).filter((r) => !provided.has(r));
 * if (unknown.length) throw new Error(`No such value: ${unknown.join(", ")}`);
 * ```
 *
 * That also catches the second reported shape — `{{ n2.transcript }}`, a real
 * node id two hops upstream, which is legal-looking and resolves to nothing
 * because a node id only addresses a *direct* predecessor. A host holding the
 * predecessor set refuses it from the same list.
 *
 * ## What it deliberately cannot catch
 *
 * `{{ in.output }}` — a real port and a field that node never emits. The root
 * is legitimate, so nothing static can separate a field that is absent from a
 * field that is absent *this run*. That is the boundary of the idea, and it is
 * stated rather than left for someone to discover.
 *
 * Throws `ExprSyntaxError` on a malformed expression, exactly as `parse` does.
 * Returning `[]` there would tell a host "this needs nothing" and let it save a
 * node that can never run.
 */
export function references(expression: string): string[] {
  const found = new Set<string>();
  collect(parse(expression), found);
  // Sorted, not insertion-ordered: three languages must produce the SAME list,
  // and a set's iteration order agrees with a sorted one often enough to look
  // correct and not always.
  return [...found].sort();
}

function collect(node: Node, out: Set<string>): void {
  switch (node.kind) {
    case "literal":
      return;

    case "path": {
      const [head, ...rest] = node.segments;
      // The head is the root. Every later segment is a step INTO it, and a
      // `.name` step is never a name the host has to supply.
      if (head && "name" in head) out.add(head.name);
      for (const segment of rest) {
        // A computed index IS a reference — `items[i]` reads `i`, and a typo'd
        // index gets the same silent empty as `$now`.
        if ("expr" in segment) collect(segment.expr, out);
      }
      return;
    }

    case "array":
      for (const item of node.items) collect(item, out);
      return;

    case "object":
      // KEYS are written, not read. Collecting them would make a host reject
      // `{ transcript: in.content }` — a false rejection at save time, which is
      // the worse direction because the author has no way to comply.
      for (const entry of node.entries) collect(entry.value, out);
      return;

    case "ternary":
      // Every branch, not only the one a run would take. A static question has
      // no run; short-circuiting here would approve an expression that fails on
      // the other road.
      collect(node.test, out);
      collect(node.then, out);
      collect(node.other, out);
      return;

    case "logical":
    case "binary":
      collect(node.left, out);
      collect(node.right, out);
      return;

    case "unary":
      collect(node.operand, out);
      return;
  }
}
