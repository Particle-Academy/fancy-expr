/**
 * The shared grammar table, run against this implementation.
 *
 * These rows were published BEFORE a line of this parser existed. That ordering
 * is the whole argument for owning the grammar rather than adopting three
 * libraries: `symfony/expression-language`, `expr-eval` and `simpleeval` are all
 * real and current and disagree with each other on the semantics below, so
 * using them would ship three subtly different languages under one syntax with
 * nobody able to fix the divergence.
 *
 * The PHP and Python implementations will be built against these same rows —
 * against the specification, not against this file's source.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/expr/evaluate/cases.json" with { type: "json" };
import { evaluate, ExprSyntaxError } from "../src/index";

type Case = {
  id: string;
  title: string;
  skip?: Record<string, string>;
  input: { expression: string; context: Record<string, unknown> };
  expected: { ok: true; value: unknown } | { ok: false };
};

const cases = (CASES as { cases: Case[] }).cases;

describe("expr/evaluate", () => {
  it("loaded the shared table", () => {
    // The vacuity guard. An empty array would make every assertion below pass
    // over nothing — the failure mode the conformance package exists to argue
    // against, and one this repo has already seen in a sibling.
    expect(cases.length).toBeGreaterThan(30);
  });

  for (const c of cases) {
    const runner = c.skip?.node ? it.skip : it;

    runner(`${c.id} — ${c.title}`, () => {
      if (!c.expected.ok) {
        // Malformed must THROW, and specifically with our own error type — a
        // TypeError from somewhere inside the evaluator would also "throw" while
        // meaning something entirely different.
        expect(() => evaluate(c.input.expression, c.input.context)).toThrow(ExprSyntaxError);
        return;
      }

      expect(evaluate(c.input.expression, c.input.context)).toEqual(c.expected.value);
    });
  }
});
