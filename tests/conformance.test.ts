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
import { formatSummary, runTable, suiteVersion } from "@particle-academy/fancy-conformance";
import COMPOSER from "../composer.json" with { type: "json" };
import PACKAGE from "../package.json" with { type: "json" };
import { evaluate, ExprSyntaxError } from "../src/index";

/**
 * The fixture set the NODE leg runs against -- and, by the assertions below, the
 * one the PHP leg installs too. Rule 4 of fancy-conformance's runners/README.md:
 * print AND assert it.
 *
 * Until 2026-09-13 the three legs ran three different sets without saying so:
 * Node was locked at 0.18.0, PHP resolved whatever was newest on Packagist (no
 * committed composer.lock), and only Python pinned. Pinned at 0.22.0 after
 * re-running both tables in every runtime -- expr/evaluate 49 (PHP skips 0904),
 * expr/references 12; both tables are byte-identical between 0.18.0 and 0.22.0.
 *
 * Moved 0.22.0 -> 0.22.1 on 2026-09-13. That release changed no case and no
 * golden (the Rust loader pins fancy-json by tag, plus docs); both tables were
 * re-run against 0.22.1 in every runtime first all the same, with the counts
 * above unchanged: expr/evaluate 49 (PHP 48 + the 0904 skip), expr/references 12.
 *
 * Moved deliberately, never automatically: a pin that follows disk asserts
 * nothing. Moving it means package.json + package-lock.json, composer.json's
 * EXACT require-dev constraint, PINNED_SUITE_VERSION here and in
 * php/tests/ConformanceTest.php, and python/tests/test_conformance.py together
 * with its CI checkout ref -- the tests on every side fail until all agree.
 */
const PINNED_SUITE_VERSION = "0.22.1";

describe("the pinned fixture set", () => {
  it("is the one installed, printed and asserted", () => {
    // Printed unconditionally: "we are on an old fixture set" belongs in the log.
    console.info(`fancy-conformance installed: ${suiteVersion()}, pinned: ${PINNED_SUITE_VERSION}`);
    expect(suiteVersion()).toBe(PINNED_SUITE_VERSION);
  });

  it("is what package.json and composer.json both declare", () => {
    // Node gets its pin from the COMMITTED lockfile, so the range keeps its
    // caret. PHP has no committed lockfile, so its constraint must be exact or
    // it resolves the newest release on the day CI runs.
    expect(PACKAGE.devDependencies["@particle-academy/fancy-conformance"]).toBe(
      `^${PINNED_SUITE_VERSION}`,
    );
    expect(COMPOSER["require-dev"]["particle-academy/fancy-conformance"]).toBe(PINNED_SUITE_VERSION);
  });
});

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

  it("prints the table summary, skips and all", () => {
    // Rule 3: the per-case tests below are the assertions; this is the log line.
    // The same shape the PHP and Python legs print, so three CI logs compare
    // like with like.
    const summary = runTable(
      "expr/evaluate",
      (c) => {
        const input = c.input as Case["input"];
        try {
          return { ok: true, value: evaluate(input.expression, input.context) };
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
