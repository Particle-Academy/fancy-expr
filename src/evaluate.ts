/**
 * The evaluator. AST + data in, value out.
 *
 * Every rule here is a row in `expr/evaluate` in
 * `@particle-academy/fancy-conformance`, and the PHP and Python
 * implementations satisfy the same rows. Where this file makes a choice a
 * reader might question, the comment says which row pins it — because the
 * places three languages drift are exactly the places a "sensible" local
 * decision is wrong.
 */
import { parse, type Node } from "./parse";

export { ExprSyntaxError } from "./tokenize";
export { parse, type Node } from "./parse";

/**
 * Is this value truthy, by THIS grammar's rules rather than the host language's?
 *
 * The table (rows `0301`-`0305`):
 *
 *   null, false, 0, ""   -> false
 *   [] and {}            -> TRUE
 *   everything else      -> true
 *
 * `[]` and `{}` being truthy is the deliberate one, and it goes against PHP's
 * and Python's native instincts — both call an empty container false. The data
 * being evaluated arrived as JSON, where an array that EXISTS is a value;
 * asking whether it is empty is what `.length` is for. Conflating the two turns
 * "did we get results?" into "did the call succeed?", which is a bug that reads
 * as correct until the day the list is empty.
 */
export function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value !== "";
  return true; // arrays and objects, empty or not
}

/** Evaluate an already-parsed expression. Throws only if `parse` did. */
export function evaluateNode(node: Node, context: Record<string, unknown>): unknown {
  switch (node.kind) {
    case "literal":
      return node.value;

    case "path":
      return resolvePath(node, context);

    case "array":
      return node.items.map((item) => evaluateNode(item, context));

    case "object": {
      const out: Record<string, unknown> = {};
      for (const { key, value } of node.entries) out[key] = evaluateNode(value, context);
      return out;
    }

    case "unary": {
      const v = evaluateNode(node.operand, context);
      if (node.op === "!") return !truthy(v);
      return typeof v === "number" ? -v : null;
    }

    case "logical": {
      // Returns the OPERAND, not a boolean (rows 0401-0404). That is what makes
      // `in.transcript || in.content` a fallback rather than merely `true` --
      // and a fallback is precisely the shape the reported production graph
      // wrote before this grammar existed.
      const left = evaluateNode(node.left, context);
      if (node.op === "&&") return truthy(left) ? evaluateNode(node.right, context) : left;
      return truthy(left) ? left : evaluateNode(node.right, context);
    }

    case "ternary":
      return truthy(evaluateNode(node.test, context))
        ? evaluateNode(node.then, context)
        : evaluateNode(node.other, context);

    case "binary":
      return binary(node.op, evaluateNode(node.left, context), evaluateNode(node.right, context));
  }
}

/** Parse and evaluate in one step. Throws `ExprSyntaxError` if it cannot parse. */
export function evaluate(expression: string, context: Record<string, unknown> = {}): unknown {
  return evaluateNode(parse(expression), context);
}

function binary(op: string, l: unknown, r: unknown): unknown {
  switch (op) {
    // ONE equality operator. `==` and `===` both arrive here as `===` and
    // neither coerces, so `'3' === 3` is false (row 0503).
    case "===":
      return strictEquals(l, r);
    case "!==":
      return !strictEquals(l, r);

    case "+":
      // Numbers add; anything involving a string concatenates (rows 0603-0604).
      if (typeof l === "number" && typeof r === "number") return l + r;
      if (typeof l === "string" || typeof r === "string") return stringify(l) + stringify(r);
      return null;

    case "-":
      return numeric(l) && numeric(r) ? (l as number) - (r as number) : null;
    case "*":
      return numeric(l) && numeric(r) ? (l as number) * (r as number) : null;
    case "/":
      // Division by zero yields null rather than Infinity or a throw. Infinity
      // is not representable in JSON, so returning it would produce a value
      // that cannot survive the round trip these expressions live in.
      return numeric(l) && numeric(r) && (r as number) !== 0 ? (l as number) / (r as number) : null;

    // Ordering compares numbers, or strings lexicographically. Mixed types are
    // false rather than an error: an absent value should not take down a run.
    case "<":
      return comparable(l, r) ? (l as never) < (r as never) : false;
    case "<=":
      return comparable(l, r) ? (l as never) <= (r as never) : false;
    case ">":
      return comparable(l, r) ? (l as never) > (r as never) : false;
    case ">=":
      return comparable(l, r) ? (l as never) >= (r as never) : false;
  }

  return null;
}

const numeric = (v: unknown): boolean => typeof v === "number";
const comparable = (l: unknown, r: unknown): boolean =>
  (typeof l === "number" && typeof r === "number") || (typeof l === "string" && typeof r === "string");

/** Deep, type-strict equality. Arrays and objects compare by structure. */
function strictEquals(l: unknown, r: unknown): boolean {
  if (l === r) return true;
  if (l === null || r === null || typeof l !== "object" || typeof r !== "object") return false;

  const lArr = Array.isArray(l);
  if (lArr !== Array.isArray(r)) return false;

  if (lArr) {
    const a = l as unknown[];
    const b = r as unknown[];
    return a.length === b.length && a.every((v, i) => strictEquals(v, b[i]));
  }

  const a = l as Record<string, unknown>;
  const b = r as Record<string, unknown>;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && strictEquals(a[k], b[k]));
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v) ?? "";
}

/**
 * Walk a path, yielding `null` the moment it cannot continue.
 *
 * `null` here means ABSENT and is a legitimate answer (row 0103) — a field that
 * is missing today may be present tomorrow. It is emphatically NOT the same as
 * a malformed expression, which threw back in `parse()` and never reached here.
 * Keeping those two outcomes distinct is the entire reason this package exists.
 *
 * Reads own properties only. No prototype chain, no methods, no host reach.
 */
function resolvePath(node: Extract<Node, { kind: "path" }>, context: Record<string, unknown>): unknown {
  let cursor: unknown = context;

  for (const segment of node.segments) {
    if (cursor === null || cursor === undefined) return null;

    const key = "name" in segment ? segment.name : stringifyKey(evaluateNode(segment.expr, context));

    // `.length` on an array or string is the ONE pseudo-property this grammar
    // provides, and it is load-bearing rather than a convenience: the decision
    // that `[]` is TRUTHY is only defensible because there is a way to ask
    // whether it is empty. Without this, "an array that exists is a value" would
    // leave a consumer no means of testing the thing they actually care about.
    //
    // It is not host reach: no method is called and no prototype is walked. A
    // count is computed. Objects deliberately have no `.length` -- there is no
    // answer three languages would agree on, and `{}` is rare as a collection.
    if (typeof cursor === "string" && key === "length") {
      cursor = cursor.length;
      continue;
    }

    if (Array.isArray(cursor)) {
      if (key === "length") {
        cursor = cursor.length;
        continue;
      }
      const idx = Number(key);
      cursor = Number.isInteger(idx) && idx >= 0 && idx < cursor.length ? cursor[idx] : null;
      continue;
    }

    if (typeof cursor === "object" && Object.prototype.hasOwnProperty.call(cursor, key)) {
      cursor = (cursor as Record<string, unknown>)[key];
      continue;
    }

    return null;
  }

  return cursor === undefined ? null : cursor;
}

const stringifyKey = (v: unknown): string => (typeof v === "number" ? String(v) : String(v ?? ""));
