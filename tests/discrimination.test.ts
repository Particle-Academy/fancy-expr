/**
 * The rules a *plausible* implementation would get wrong.
 *
 * The conformance table passed 39/39 on this parser's first run. That is the
 * moment to be suspicious rather than pleased: a table every reasonable
 * implementation passes proves nothing, and the three semantics below are
 * exactly where a competent person writing this in PHP or Python would
 * reasonably do something else and be silently incompatible.
 *
 * Each block names what a wrong implementation would return and which
 * conformance rows would flip. They assert at the SOURCE of each rule — the
 * exported primitive — rather than only through the table, so a port author can
 * see the intent without reverse-engineering it from a fixture.
 *
 * A full mutant harness (deliberately-wrong evaluators failing an EXACT set of
 * ids, the way `shared/decimal` has) is still owed and is recorded in the
 * suite's manifest. This is the cheap half of it, not a substitute.
 */
import { describe, expect, it } from "vitest";
import { evaluate, truthy } from "../src/index";

describe("truthiness — where PHP and Python would natively disagree", () => {
  it("treats [] and {} as TRUTHY", () => {
    // PHP: `(bool) []` is FALSE. Python: `bool([])` is False. Both would flip
    // conformance rows 0301 and 0302 while looking perfectly idiomatic.
    //
    // We follow JSON's meaning instead: an array that EXISTS is a value.
    // Whether it is empty is what `.length` asks. Conflating them turns
    // "did we get results?" into "did the call succeed?" — a check that reads
    // as correct right up until the day the list comes back empty.
    expect(truthy([])).toBe(true);
    expect(truthy({})).toBe(true);
  });

  it("still treats 0, empty string, null and false as falsy", () => {
    // The other half. Without this, "everything is truthy" would also pass the
    // block above, and that is a different wrong answer.
    expect(truthy(0)).toBe(false);
    expect(truthy("")).toBe(false);
    expect(truthy(null)).toBe(false);
    expect(truthy(false)).toBe(false);
    expect(truthy("0")).toBe(true); // a non-empty string, PHP's other trap
  });
});

describe("equality — one operator, no coercion", () => {
  it("does not coerce across types", () => {
    // A PHP author reaching for `==` gets loose comparison and `'3' == 3` is
    // TRUE, flipping row 0503. Both spellings arrive here as the same strict
    // operator precisely so that cannot happen in one runtime and not another.
    expect(evaluate("'3' === 3")).toBe(false);
    expect(evaluate("'3' == 3")).toBe(false);
  });

  it("compares arrays and objects by structure, not identity", () => {
    // JavaScript's `===` on two structurally identical objects is FALSE, which
    // is the trap in the other direction — an idiomatic JS implementation would
    // get this wrong while PHP's `==` would get it right.
    expect(evaluate("[1,2] === [1,2]")).toBe(true);
    expect(evaluate("{a:1} === {a:1}")).toBe(true);
    expect(evaluate("[1,2] === [2,1]")).toBe(false);
  });
});

describe("short-circuit — returns the OPERAND, not a boolean", () => {
  it("yields values rather than true/false", () => {
    // An implementation returning booleans passes any test that only checks
    // truthiness, and flips rows 0401/0403/0404. It also destroys the single
    // most useful shape in the grammar: the fallback.
    expect(evaluate("a || b", { a: null, b: "fallback" })).toBe("fallback");
    expect(evaluate("a || b", { a: "first", b: "second" })).toBe("first");
    expect(evaluate("a && b", { a: "yes", b: "second" })).toBe("second");
    expect(evaluate("a && b", { a: 0, b: "unused" })).toBe(0);
  });
});

describe("absence and malformity are different outcomes", () => {
  it("returns null for an absent path and THROWS for a broken expression", () => {
    // The defect this package exists to remove, stated as one assertion. Before
    // it, both of these produced null — so a condition the engine could not
    // evaluate silently read as false and a live graph took the wrong branch on
    // every run while reporting success.
    expect(evaluate("in.nothing", { in: {} })).toBe(null);
    expect(() => evaluate("in.a &&", { in: {} })).toThrow();
  });
});

describe(".length — the one pseudo-property, and why it must exist", () => {
  it("counts arrays and strings", () => {
    // Load-bearing rather than convenient. `[]` being TRUTHY is only defensible
    // because there IS a way to ask whether it is empty; without this, the
    // grammar would say "an array that exists is a value" and leave a consumer
    // no means of testing the thing they actually care about.
    //
    // Caught by writing this file: GRAMMAR.md justified the truthiness rule with
    // `.length` while the implementation returned null for it. Prose promising
    // what the code does not do -- in a package written the same hour.
    expect(evaluate("x.length", { x: [1, 2] })).toBe(2);
    expect(evaluate("x.length", { x: [] })).toBe(0);
    expect(evaluate("s.length", { s: "abc" })).toBe(3);
    expect(evaluate("x.length === 0 ? 'empty' : 'has items'", { x: [] })).toBe("empty");
  });

  it("gives objects no .length, because no answer would survive three languages", () => {
    expect(evaluate("o.length", { o: {} })).toBe(null);
  });
});

describe("the sandbox holds", () => {
  it("cannot reach host properties, prototypes or methods", () => {
    // Own properties only. These expressions arrive from end users and from
    // agents, over the wire — this is a security boundary, not a style choice.
    expect(evaluate("x.constructor", { x: {} })).toBe(null);
    expect(evaluate("x.__proto__", { x: {} })).toBe(null);
    expect(evaluate("x.toString", { x: {} })).toBe(null);
    // `.length` IS exposed -- see the block below. It is a computed count, not
    // a host method, and the truthiness rule depends on it existing.
  });

  it("refuses calls at PARSE time, so a host can reject them before saving", () => {
    expect(() => evaluate("alert('hi')")).toThrow();
    expect(() => evaluate("x.map(y)", { x: [] })).toThrow();
  });
});
