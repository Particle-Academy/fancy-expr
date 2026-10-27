/**
 * The parser. Tokens in, AST out, or it throws.
 *
 * A plain recursive-descent parser following `GRAMMAR.md` exactly, one function
 * per precedence level, lowest first. Deliberately boring: the grammar is the
 * interesting artifact, and a parser that departs from it to be clever is a
 * parser that disagrees with the other two implementations.
 *
 * ## Separable from evaluation ON PURPOSE
 *
 * `parse()` needs no data. That is what lets a host ask *"is this expression
 * valid?"* while a person is still typing it, and reject a node whose
 * expression can never work at SAVE time rather than discovering it mid-run.
 * The whole defect this package replaces was a malformed expression being
 * indistinguishable from an absent value at run time.
 *
 * ## Bounded, because the input is hostile by assumption
 *
 * GRAMMAR.md "Limits": at most {@link MAX_EXPRESSION_BYTES} UTF-8 bytes and a
 * nesting depth of at most {@link MAX_EXPRESSION_DEPTH}. Without them,
 * `((((...` from an end user overflowed the stack -- a RangeError, which is not
 * ExprSyntaxError, so a host validating at save time crashed instead of
 * refusing. Depth is enforced twice, against ONE definition:
 *
 * - on the way DOWN (`child`), so no input can recurse past the limit before
 *   the parser knows -- the finished tree cannot be measured if building it is
 *   what overflows;
 * - on the way UP (`finish`), because a binary chain is built in a loop and
 *   never recurses here, but builds a left-deep tree the evaluator DOES
 *   recurse through.
 */
import { ExprSyntaxError, tokenize, type Token } from "./tokenize";

/** Longest accepted expression, in UTF-8 bytes. Inclusive. */
export const MAX_EXPRESSION_BYTES = 8192;

/** Deepest accepted expression, by GRAMMAR.md's definition of depth. Inclusive. */
export const MAX_EXPRESSION_DEPTH = 64;

export type Node =
  | { kind: "literal"; value: unknown }
  | { kind: "path"; segments: Array<{ name: string } | { expr: Node }> }
  | { kind: "unary"; op: "!" | "-"; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "logical"; op: "&&" | "||"; left: Node; right: Node }
  | { kind: "ternary"; test: Node; then: Node; other: Node }
  | { kind: "array"; items: Node[] }
  | { kind: "object"; entries: Array<{ key: string; value: Node }> };

/**
 * UTF-8 length without allocating an encoded copy, stopping as soon as the
 * limit is passed. A lone surrogate counts 3 bytes, as Python's
 * `surrogatepass` and PHP's raw bytes would see it after a JSON round trip.
 */
function utf8LengthExceeds(source: string, limit: number): number | null {
  // Cheap reject and cheap accept first: every UTF-16 unit is 1 to 3 bytes.
  if (source.length > limit) return source.length;
  if (source.length * 3 <= limit) return null;

  let bytes = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < source.length && (source.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes > limit ? bytes : null;
}

export function parse(source: string): Node {
  // Length FIRST, before a single token is read (expr/limits 0005): refusing
  // an oversized input should cost nothing, and its message must not quote it.
  const bytes = utf8LengthExceeds(source, MAX_EXPRESSION_BYTES);
  if (bytes !== null) {
    throw new ExprSyntaxError(
      `Expression too long: the limit is ${MAX_EXPRESSION_BYTES} UTF-8 bytes`,
      source,
      0,
      "EXPR_TOO_LONG",
    );
  }

  const tokens = tokenize(source);
  const state: State = { tokens, i: 0, source, nest: 0, depth: 0 };

  // An empty expression is malformed rather than null. `{{ }}` says nothing,
  // and silently producing a value for it would be the same class of guess this
  // package exists to remove.
  if (peek(state).type === "eof") {
    throw new ExprSyntaxError("Empty expression", source, 0);
  }

  const node = parseTernary(state);

  // Trailing junk is an error. Without this, `in.a in.b` would parse as `in.a`
  // and silently ignore the rest — the single easiest way for a typo to become
  // a wrong answer instead of a message.
  const rest = peek(state);
  if (rest.type !== "eof") {
    throw new ExprSyntaxError(`Unexpected \`${rest.value}\``, source, rest.at);
  }

  return node;
}

/**
 * `nest` is how many constructs enclose the point being parsed; `depth` is the
 * depth of the node most recently FINISHED, read by its parent straight after.
 */
type State = { tokens: Token[]; i: number; source: string; nest: number; depth: number };

const peek = (s: State): Token => s.tokens[s.i];
const next = (s: State): Token => s.tokens[s.i++];

function tooDeep(s: State): ExprSyntaxError {
  return new ExprSyntaxError(
    `Expression nested too deeply: ${MAX_EXPRESSION_DEPTH} levels is the limit`,
    s.source,
    peek(s).at,
    "EXPR_TOO_DEEP",
  );
}

/**
 * Parse a CHILD of a construct. `nest` then counts every enclosing construct
 * including the parent, and the child is at least one level itself -- so once
 * `nest` reaches the limit the finished tree must exceed it, and refusing now
 * is the same verdict `finish` would reach, minus the recursion.
 */
function child<T>(s: State, parseIt: (s: State) => T): T {
  s.nest += 1;
  try {
    if (s.nest >= MAX_EXPRESSION_DEPTH) throw tooDeep(s);
    return parseIt(s);
  } finally {
    s.nest -= 1;
  }
}

/** Record a finished node's depth, refusing it if it is past the limit. */
function finish<T>(s: State, node: T, depth: number): T {
  if (depth > MAX_EXPRESSION_DEPTH) throw tooDeep(s);
  s.depth = depth;
  return node;
}

function isPunct(s: State, ...values: string[]): boolean {
  const t = peek(s);
  return t.type === "punct" && values.includes(t.value as string);
}

function eat(s: State, value: string): boolean {
  if (isPunct(s, value)) {
    s.i += 1;
    return true;
  }
  return false;
}

function expect(s: State, value: string): void {
  if (!eat(s, value)) {
    const t = peek(s);
    throw new ExprSyntaxError(`Expected \`${value}\``, s.source, t.at);
  }
}

function parseTernary(s: State): Node {
  const test = parseOr(s);
  if (!eat(s, "?")) return test;
  const testDepth = s.depth;

  const then = child(s, parseTernary);
  const thenDepth = s.depth;
  expect(s, ":");
  const other = child(s, parseTernary);
  return finish(s, { kind: "ternary", test, then, other }, 1 + Math.max(testDepth, thenDepth, s.depth));
}

/**
 * One left-associative precedence level. The chain is a LOOP -- it never
 * recurses here -- but each operator wraps everything to its left, so a long
 * chain is a deep tree and `finish` measures it.
 */
function chain(s: State, operand: (s: State) => Node, build: (op: string, left: Node, right: Node) => Node, ...ops: string[]): Node {
  let left = operand(s);
  while (isPunct(s, ...ops)) {
    const raw = next(s).value as string;
    const leftDepth = s.depth;
    const right = operand(s);
    left = finish(s, build(raw, left, right), 1 + Math.max(leftDepth, s.depth));
  }
  return left;
}

function parseOr(s: State): Node {
  return chain(s, parseAnd, (_, left, right) => ({ kind: "logical", op: "||", left, right }), "||");
}

function parseAnd(s: State): Node {
  return chain(s, parseEquality, (_, left, right) => ({ kind: "logical", op: "&&", left, right }), "&&");
}

function parseEquality(s: State): Node {
  // `==` and `===` collapse to ONE operator here, and so do `!=` and `!==`.
  // Both spellings are accepted because authors write both; neither coerces.
  // Two equality operators that differ subtly is a language that generates
  // bug reports, and there are three runtimes to keep in step.
  return chain(
    s,
    parseComparison,
    (raw, left, right) => ({ kind: "binary", op: raw.startsWith("!") ? "!==" : "===", left, right }),
    "===", "==", "!==", "!=",
  );
}

function parseComparison(s: State): Node {
  return chain(s, parseAdditive, (op, left, right) => ({ kind: "binary", op, left, right }), "<", "<=", ">", ">=");
}

function parseAdditive(s: State): Node {
  return chain(s, parseMultiplicative, (op, left, right) => ({ kind: "binary", op, left, right }), "+", "-");
}

function parseMultiplicative(s: State): Node {
  return chain(s, parseUnary, (op, left, right) => ({ kind: "binary", op, left, right }), "*", "/");
}

function parseUnary(s: State): Node {
  if (isPunct(s, "!", "-")) {
    const op = next(s).value as "!" | "-";
    const operand = child(s, parseUnary);
    return finish(s, { kind: "unary", op, operand }, 1 + s.depth);
  }
  return parsePrimary(s);
}

function parsePrimary(s: State): Node {
  const t = peek(s);

  if (t.type === "number" || t.type === "string") {
    s.i += 1;
    return finish(s, { kind: "literal", value: t.value }, 1);
  }

  if (t.type === "ident") {
    const name = t.value as string;
    if (name === "true" || name === "false" || name === "null") {
      s.i += 1;
      return finish(s, { kind: "literal", value: name === "null" ? null : name === "true" }, 1);
    }
    return parsePath(s);
  }

  if (eat(s, "(")) {
    // A group leaves no node in the tree but IS a level: the parser recurses
    // through it, and recursion is what the limit bounds (expr/limits 0102).
    const inner = child(s, parseTernary);
    expect(s, ")");
    return finish(s, inner, 1 + s.depth);
  }

  if (eat(s, "[")) {
    const items: Node[] = [];
    let deepest = 0;
    if (!isPunct(s, "]")) {
      do {
        items.push(child(s, parseTernary));
        deepest = Math.max(deepest, s.depth);
      } while (eat(s, ","));
    }
    expect(s, "]");
    return finish(s, { kind: "array", items }, 1 + deepest);
  }

  if (eat(s, "{")) {
    const entries: Array<{ key: string; value: Node }> = [];
    let deepest = 0;
    if (!isPunct(s, "}")) {
      do {
        const k = next(s);
        if (k.type !== "ident" && k.type !== "string") {
          throw new ExprSyntaxError("Expected an object key", s.source, k.at);
        }
        expect(s, ":");
        entries.push({ key: String(k.value), value: child(s, parseTernary) });
        deepest = Math.max(deepest, s.depth);
      } while (eat(s, ","));
    }
    expect(s, "}");
    return finish(s, { kind: "object", entries }, 1 + deepest);
  }

  throw new ExprSyntaxError(`Unexpected \`${t.value || "end of expression"}\``, s.source, t.at);
}

function parsePath(s: State): Node {
  const segments: Array<{ name: string } | { expr: Node }> = [];
  const head = next(s);
  segments.push({ name: head.value as string });
  // Dot-segments are read and walked in loops and nest nothing (expr/limits
  // 0801); only a computed index is a nested expression.
  let deepest = 0;

  for (;;) {
    if (eat(s, ".")) {
      const seg = next(s);
      if (seg.type !== "ident") {
        throw new ExprSyntaxError("Expected a path segment", s.source, seg.at);
      }
      segments.push({ name: seg.value as string });
      continue;
    }

    if (eat(s, "[")) {
      const idx = child(s, parseTernary);
      deepest = Math.max(deepest, s.depth);
      expect(s, "]");
      segments.push({ expr: idx });
      continue;
    }

    // A `(` here would be a function call. Refused DELIBERATELY: this grammar
    // has no calls, because these expressions arrive from end users and from
    // agents, over the wire. Sandboxing is a security property, not a style.
    if (isPunct(s, "(")) {
      throw new ExprSyntaxError(
        "Function calls are not supported — this is an expression grammar, not a language",
        s.source,
        peek(s).at,
      );
    }

    return finish(s, { kind: "path", segments }, 1 + deepest);
  }
}
