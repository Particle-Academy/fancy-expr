/**
 * `expr/references` — the static question, run against this implementation.
 *
 * Same discipline as `conformance.test.ts`: the rows were published before the
 * function existed, and the PHP and Python ports are built against them rather
 * than against `src/references.ts`.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/expr/references/cases.json" with { type: "json" };
import { formatSummary, runTable } from "@particle-academy/fancy-conformance";
import { ExprSyntaxError, references } from "../src/index";

type Case = {
  id: string;
  title: string;
  skip?: Record<string, string>;
  input: { expression: string };
  expected: { ok: true; value: string[] } | { ok: false };
};

const cases = (CASES as { cases: Case[] }).cases;

describe("expr/references", () => {
  it("loaded the shared table", () => {
    // The vacuity guard. An empty array passes every assertion below over
    // nothing, and reads exactly as green in a CI log.
    expect(cases.length).toBeGreaterThan(8);
  });

  it("prints the table summary, skips and all", () => {
    // Rule 3: the per-case tests below are the assertions; this is the log line.
    // The pinned version is asserted in conformance.test.ts.
    const summary = runTable(
      "expr/references",
      (c) => {
        try {
          return { ok: true, value: references((c.input as Case["input"]).expression) };
        } catch (error) {
          if (error instanceof ExprSyntaxError) return { ok: false };
          throw error;
        }
      },
      { language: "node" },
    );

    console.info(`\n${formatSummary(summary)}`);
    expect(summary.ok, formatSummary(summary)).toBe(true);
    expect(summary.passed + summary.skipped).toBe(cases.length);
  });

  for (const c of cases) {
    const runner = c.skip?.node ? it.skip : it;

    runner(`${c.id} — ${c.title}`, () => {
      if (!c.expected.ok) {
        expect(() => references(c.input.expression)).toThrow(ExprSyntaxError);
        return;
      }

      expect(references(c.input.expression)).toEqual(c.expected.value);
    });
  }
});

describe("the host owns the allowlist, not this package", () => {
  it("is enough to reject the reported $now, with a message naming it", () => {
    // The consumer's case, as the check a host would actually write. `$now`
    // looks exactly as valid as `$json` to an author, and rendered a document
    // titled "Deal List Export -" with the date silently missing.
    const provided = new Set(["in", "$json", "$input", "$props"]);
    const unknown = (expr: string) => references(expr).filter((r) => !provided.has(r));

    expect(unknown("'Deal List Export - ' + $now")).toEqual(["$now"]);
    expect(unknown("'Deal List Export - ' + $json.date")).toEqual([]);
  });

  it("also rejects a node id that is not a direct predecessor", () => {
    // The second reported shape: `n2.transcript` is a REAL node id two hops
    // upstream. Legal-looking, resolves to nothing. One primitive, both shapes.
    const predecessors = new Set(["in", "n5"]);
    expect(references("n2.transcript").filter((r) => !predecessors.has(r))).toEqual(["n2"]);
  });

  it("CANNOT catch a real root with a field that node never emits", () => {
    // The boundary, asserted rather than left to be discovered. `in.output` is
    // a legitimate root, so nothing static separates "this field is absent"
    // from "this field is absent THIS RUN". Stated in the manifest too.
    expect(references("in.output")).toEqual(["in"]);
  });
});

describe("the rules a plausible-but-wrong implementation would get wrong", () => {
  it("does not collect object-literal keys", () => {
    // The damaging direction: reporting `transcript` would make a host reject a
    // valid expression, and the author would have no way to comply.
    expect(references("{ transcript: in.content, source: 'manual' }")).toEqual(["in"]);
  });

  it("does not short-circuit a ternary the way the evaluator does", () => {
    // Reusing the evaluator's walk is the obvious implementation and reports
    // only what one run touched — approving an expression that fails on the
    // other road.
    expect(references("a ? b : c")).toEqual(["a", "b", "c"]);
    expect(references("a || b")).toEqual(["a", "b"]);
  });

  it("counts a computed index but not a named step", () => {
    // A walker that only handled `.name` steps passes every other assertion.
    expect(references("items[i]")).toEqual(["i", "items"]);
    expect(references("items.length")).toEqual(["items"]);
    expect(references("items[0]")).toEqual(["items"]);
  });

  it("throws rather than returning [] for a malformed expression", () => {
    // `[]` would tell a host "this expression needs nothing" and let it save a
    // node that can never run — the same collapse this package exists to undo.
    expect(() => references("in.a &&")).toThrow(ExprSyntaxError);
    expect(() => references("")).toThrow(ExprSyntaxError);
  });
});
