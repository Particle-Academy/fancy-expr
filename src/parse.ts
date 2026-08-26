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
 */
import { ExprSyntaxError, tokenize, type Token } from "./tokenize";

export type Node =
  | { kind: "literal"; value: unknown }
  | { kind: "path"; segments: Array<{ name: string } | { expr: Node }> }
  | { kind: "unary"; op: "!" | "-"; operand: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "logical"; op: "&&" | "||"; left: Node; right: Node }
  | { kind: "ternary"; test: Node; then: Node; other: Node }
  | { kind: "array"; items: Node[] }
  | { kind: "object"; entries: Array<{ key: string; value: Node }> };

export function parse(source: string): Node {
  const tokens = tokenize(source);
  const state = { tokens, i: 0, source };

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

type State = { tokens: Token[]; i: number; source: string };

const peek = (s: State): Token => s.tokens[s.i];
const next = (s: State): Token => s.tokens[s.i++];

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

  const then = parseTernary(s);
  expect(s, ":");
  const other = parseTernary(s);
  return { kind: "ternary", test, then, other };
}

function parseOr(s: State): Node {
  let left = parseAnd(s);
  while (isPunct(s, "||")) {
    s.i += 1;
    left = { kind: "logical", op: "||", left, right: parseAnd(s) };
  }
  return left;
}

function parseAnd(s: State): Node {
  let left = parseEquality(s);
  while (isPunct(s, "&&")) {
    s.i += 1;
    left = { kind: "logical", op: "&&", left, right: parseEquality(s) };
  }
  return left;
}

function parseEquality(s: State): Node {
  let left = parseComparison(s);
  while (isPunct(s, "===", "==", "!==", "!=")) {
    // `==` and `===` collapse to ONE operator here, and so do `!=` and `!==`.
    // Both spellings are accepted because authors write both; neither coerces.
    // Two equality operators that differ subtly is a language that generates
    // bug reports, and there are three runtimes to keep in step.
    const raw = next(s).value as string;
    const op = raw.startsWith("!") ? "!==" : "===";
    left = { kind: "binary", op, left, right: parseComparison(s) };
  }
  return left;
}

function parseComparison(s: State): Node {
  let left = parseAdditive(s);
  while (isPunct(s, "<", "<=", ">", ">=")) {
    const op = next(s).value as string;
    left = { kind: "binary", op, left, right: parseAdditive(s) };
  }
  return left;
}

function parseAdditive(s: State): Node {
  let left = parseMultiplicative(s);
  while (isPunct(s, "+", "-")) {
    const op = next(s).value as string;
    left = { kind: "binary", op, left, right: parseMultiplicative(s) };
  }
  return left;
}

function parseMultiplicative(s: State): Node {
  let left = parseUnary(s);
  while (isPunct(s, "*", "/")) {
    const op = next(s).value as string;
    left = { kind: "binary", op, left, right: parseUnary(s) };
  }
  return left;
}

function parseUnary(s: State): Node {
  if (isPunct(s, "!", "-")) {
    const op = next(s).value as "!" | "-";
    return { kind: "unary", op, operand: parseUnary(s) };
  }
  return parsePrimary(s);
}

function parsePrimary(s: State): Node {
  const t = peek(s);

  if (t.type === "number" || t.type === "string") {
    s.i += 1;
    return { kind: "literal", value: t.value };
  }

  if (t.type === "ident") {
    const name = t.value as string;
    if (name === "true" || name === "false" || name === "null") {
      s.i += 1;
      return { kind: "literal", value: name === "null" ? null : name === "true" };
    }
    return parsePath(s);
  }

  if (eat(s, "(")) {
    const inner = parseTernary(s);
    expect(s, ")");
    return inner;
  }

  if (eat(s, "[")) {
    const items: Node[] = [];
    if (!isPunct(s, "]")) {
      do {
        items.push(parseTernary(s));
      } while (eat(s, ","));
    }
    expect(s, "]");
    return { kind: "array", items };
  }

  if (eat(s, "{")) {
    const entries: Array<{ key: string; value: Node }> = [];
    if (!isPunct(s, "}")) {
      do {
        const k = next(s);
        if (k.type !== "ident" && k.type !== "string") {
          throw new ExprSyntaxError("Expected an object key", s.source, k.at);
        }
        expect(s, ":");
        entries.push({ key: String(k.value), value: parseTernary(s) });
      } while (eat(s, ","));
    }
    expect(s, "}");
    return { kind: "object", entries };
  }

  throw new ExprSyntaxError(`Unexpected \`${t.value || "end of expression"}\``, s.source, t.at);
}

function parsePath(s: State): Node {
  const segments: Array<{ name: string } | { expr: Node }> = [];
  const head = next(s);
  segments.push({ name: head.value as string });

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
      const idx = parseTernary(s);
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

    return { kind: "path", segments };
  }
}
