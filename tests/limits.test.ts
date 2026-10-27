/**
 * The input bounds, from GRAMMAR.md "Limits".
 *
 * The authoritative rows are `expr/limits` in fancy-conformance (since 0.35.0),
 * and this repository pins 0.35.0: tests/conformance.test.ts runs all 27 of
 * them from the pinned package. This file keeps the per-language probes the
 * table cannot express -- the exported constants, the message not quoting an
 * oversized expression, and references() hitting the same bounds -- plus a
 * direct copy of the boundary checks, so a limit regression names itself here
 * as well as by case id.
 *
 * Every limit is asserted from BOTH sides: refusing everything long or nested
 * would pass the out-of-limit half alone.
 */
import { describe, expect, it } from "vitest";
import { evaluate, parse, references, ExprSyntaxError, MAX_EXPRESSION_BYTES, MAX_EXPRESSION_DEPTH } from "../src/index";

function codeOf(expression: string, context: Record<string, unknown> = {}): string {
  try {
    evaluate(expression, context);
  } catch (error) {
    if (error instanceof ExprSyntaxError) return error.code;
    throw error;
  }
  return "OK";
}

describe("the limits are the documented ones", () => {
  it("is 8192 bytes and 64 levels", () => {
    expect(MAX_EXPRESSION_BYTES).toBe(8192);
    expect(MAX_EXPRESSION_DEPTH).toBe(64);
  });
});

describe("length, in UTF-8 bytes", () => {
  it("accepts exactly 8192 bytes and refuses 8193", () => {
    expect(evaluate("1" + " ".repeat(8191))).toBe(1);
    expect(codeOf("1" + " ".repeat(8192))).toBe("EXPR_TOO_LONG");
  });

  it("counts bytes, not UTF-16 units", () => {
    // 4096 x U+00E9 in quotes: 4098 UTF-16 units, 8194 bytes.
    expect(codeOf("'" + "é".repeat(4096) + "'")).toBe("EXPR_TOO_LONG");
    expect(evaluate("'" + "é".repeat(4095) + "'")).toBe("é".repeat(4095));
  });

  it("checks length before tokenizing", () => {
    expect(codeOf("@".repeat(8193))).toBe("EXPR_TOO_LONG");
  });

  it("does not put an oversized expression in the message", () => {
    try {
      parse("1" + " ".repeat(9000));
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(200);
      return;
    }
    throw new Error("expected a throw");
  });
});

describe("nesting depth", () => {
  const shapes: Array<[string, (n: number) => string, number]> = [
    ["parentheses", (n) => "(".repeat(n) + "1" + ")".repeat(n), 63],
    ["unary", (n) => "!".repeat(n) + "true", 63],
    ["binary chain", (n) => Array(n + 1).fill("1").join("+"), 63],
    ["arrays", (n) => "[".repeat(n) + "]".repeat(n), 64],
    ["objects", (n) => "{a:".repeat(n) + "1" + "}".repeat(n), 63],
    ["indices", (n) => "x[".repeat(n) + "0" + "]".repeat(n), 63],
    ["ternaries", (n) => "false ? 0 : ".repeat(n) + "1", 63],
  ];

  for (const [name, build, atLimit] of shapes) {
    it(`${name}: ${atLimit} evaluates, ${atLimit + 1} is EXPR_TOO_DEEP`, () => {
      expect(codeOf(build(atLimit), { x: [0] })).toBe("OK");
      expect(codeOf(build(atLimit + 1), { x: [0] })).toBe("EXPR_TOO_DEEP");
    });
  }

  it("refuses the stack-overflow shape with its own error, not a RangeError", () => {
    expect(codeOf("(".repeat(4000) + "1" + ")".repeat(4000))).toBe("EXPR_TOO_DEEP");
    expect(codeOf("(".repeat(8000))).toBe("EXPR_TOO_DEEP");
    expect(codeOf(Array(4000).fill("1").join("+"))).toBe("EXPR_TOO_DEEP");
  });

  it("does not count dot-segments or width", () => {
    expect(evaluate("a" + ".b".repeat(500))).toBeNull();
    expect(evaluate("[" + Array(1000).fill("1").join(",") + "]")).toHaveLength(1000);
  });

  it("applies to references() too, which parses the same way", () => {
    expect(() => references("(".repeat(8000))).toThrow(ExprSyntaxError);
  });
});

describe("codes", () => {
  it("gives every other parse failure EXPR_SYNTAX", () => {
    expect(codeOf("in.a &&")).toBe("EXPR_SYNTAX");
    expect(codeOf("'unterminated")).toBe("EXPR_SYNTAX");
    expect(codeOf("f()")).toBe("EXPR_SYNTAX");
  });
});
