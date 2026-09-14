"""The shared grammar table, run against the Python implementation.

These rows were published BEFORE any implementation existed, and this port was
written against THEM and ``GRAMMAR.md`` rather than against the TypeScript
source. That is the whole argument for owning the grammar: simpleeval,
expr-eval and symfony/expression-language are all real and current and disagree
with each other on exactly the semantics below.

Python is the runtime whose native instincts diverge in the most places, and
the discrimination block names each one.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest
from fancy_conformance import format_summary, run_table, version

from fancy_expr import ExprSyntaxError, evaluate, truthy

# The fixture set the PYTHON job runs against. It checks fancy-conformance out
# from git (its loader is never on PyPI), so without a pin and a matching `ref`
# it would test whatever `main` is on the day: every fixture release could turn
# this job red for a reason no commit here caused. Pinned at 0.22.0 on 2026-09-13
# after re-running both tables against a v0.22.0 checkout: expr/evaluate 49,
# expr/references 12, nothing failed or skipped.
#
# Moved 0.22.0 -> 0.22.1 on 2026-09-13. That release changed no case and no
# golden (the Rust loader pins fancy-json by tag, plus docs); both tables were
# re-run against a v0.22.1 checkout first all the same: expr/evaluate 49,
# expr/references 12, nothing failed or skipped, unchanged.
#
# The Node and PHP jobs get the fixtures from npm and Packagist, and pin the SAME
# version there: package.json's range plus the committed lockfile for Node, an
# exact require-dev constraint for PHP. php/tests/ConformanceTest.php fails if
# this constant, composer.json and package.json disagree. CI checks out
# `ref: v<this>` in .github/workflows/ci.yml. Move all of them together, and only
# after re-running the tables in every runtime;
# test_ci_checks_out_the_fixture_tag_this_suite_pins fails otherwise.
PINNED_SUITE_VERSION = "0.22.1"


def test_the_pinned_fixture_version_is_the_one_on_disk(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with capsys.disabled():
        print(f"\nfancy-conformance on disk: {version()}, pinned: {PINNED_SUITE_VERSION}")

    assert version() == PINNED_SUITE_VERSION, (
        f"fancy-conformance is at {version()}, this implementation pins "
        f"{PINNED_SUITE_VERSION}. Re-run the suites and move the pin deliberately."
    )


def _conformance_checkout_refs(workflow: str) -> list[str | None]:
    """The `ref:` of every workflow step that checks out fancy-conformance.

    Plain text on purpose: a YAML parser would be a dependency for one assertion.
    A step is a `- ` line plus everything indented deeper than it. `None` is a
    step with no `ref`, which checks out whatever `main` is at that moment.
    """
    lines = workflow.splitlines()
    refs: list[str | None] = []
    for index, line in enumerate(lines):
        start = re.match(r"(\s*)- ", line)
        if not start:
            continue
        step = [line]
        for following in lines[index + 1 :]:
            body = following.strip()
            indent = len(following) - len(following.lstrip())
            if body and not body.startswith("#") and indent <= len(start.group(1)):
                break
            step.append(following)
        text = "\n".join(step)
        if re.search(
            r"^\s*(- )?repository:\s*[\"']?Particle-Academy/fancy-conformance[\"']?\s*(#.*)?$",
            text,
            re.MULTILINE,
        ):
            ref = re.search(r"^\s*(- )?ref:\s*[\"']?([^\"'\s#]+)", text, re.MULTILINE)
            refs.append(ref.group(2) if ref else None)
    return refs


def test_the_checkout_ref_parser_sees_a_missing_ref() -> None:
    workflow = """
      - uses: actions/checkout@v4
        with:
          repository: Particle-Academy/fancy-conformance
          path: .fancy-conformance
      - name: Pinned
        uses: actions/checkout@v4
        with:
          repository: "Particle-Academy/fancy-conformance"
          ref: 'v1.2.3'  # a comment
      - uses: actions/checkout@v4
        with:
          repository: Particle-Academy/fancy-flow
          ref: v9.9.9
    """
    assert _conformance_checkout_refs(workflow) == [None, "v1.2.3"]


def test_ci_checks_out_the_fixture_tag_this_suite_pins() -> None:
    """The CI checkout `ref` and `PINNED_SUITE_VERSION` are one decision in two files.

    The Python job used to check fancy-conformance out with no `ref`, so every
    fixture release could turn it red at once for a reason no commit here caused;
    four sibling ports sat red for weeks exactly that way. The pin is the
    contract: moving it is a deliberate commit in this repository, never a side
    effect of someone else's release.
    """
    here = Path(__file__).resolve()
    workflows = next(
        (p / ".github" / "workflows" for p in here.parents if (p / ".github/workflows").is_dir()),
        None,
    )
    assert workflows is not None, f"no .github/workflows above {here}"

    refs = {
        path.name: _conformance_checkout_refs(path.read_text(encoding="utf-8"))
        for path in sorted(workflows.glob("*.y*ml"))
    }
    refs = {name: found for name, found in refs.items() if found}
    # Vacuity guard: a parser that matched nothing would satisfy the loop below.
    assert refs, "no workflow checks out Particle-Academy/fancy-conformance"

    expected = f"v{PINNED_SUITE_VERSION}"
    for name, found in refs.items():
        assert found == [expected] * len(found), (
            f".github/workflows/{name} checks fancy-conformance out at {found}, but this "
            f"suite pins {PINNED_SUITE_VERSION}. Set `ref: {expected}` there, and move "
            "the pin and the ref together."
        )


def run_expr_case(case: dict[str, Any]) -> dict[str, Any]:
    try:
        value = evaluate(case["input"]["expression"], case["input"].get("context") or {})
    except ExprSyntaxError:
        # Malformed. NEVER None -- a None here would be indistinguishable from
        # an absent path, which is the defect this package removes.
        return {"ok": False}

    return {"ok": True, "value": value}


def test_matches_the_table_on_every_case(capsys: pytest.CaptureFixture[str]) -> None:
    summary = run_table("expr/evaluate", run_expr_case)

    with capsys.disabled():
        print("\n" + format_summary(summary))

    failures = [r["id"] for r in summary["results"] if r["status"] == "fail"]
    assert failures == [], f"Python disagrees with the shared grammar on: {', '.join(failures)}"
    assert summary["failed"] == 0

    # The vacuity floor. A suite that loaded nothing reports zero failures too,
    # and reads exactly as green in a CI log.
    assert summary["passed"] > 40


def test_resists_what_python_would_natively_do() -> None:
    """The four places a competent Python author would reasonably diverge."""
    # 1. `bool([])` and `bool({})` are False in Python. Here an array that
    #    EXISTS is a value; whether it is empty is what `.length` asks.
    assert truthy([]) is True
    assert truthy({}) is True
    assert truthy(0) is False
    assert truthy("") is False
    assert truthy(None) is False
    assert truthy("0") is True

    # 2. `True == 1` is True in Python. It must not be here, or `flag === 1`
    #    answers differently in this runtime than in the other two. No
    #    conformance row covers it, which is precisely why it is asserted.
    assert evaluate("f === 1", {"f": True}) is False
    assert evaluate("z === 0", {"z": False}) is False
    assert evaluate("f === true", {"f": True}) is True

    # 3. `isinstance(True, int)` is True, so an unguarded numeric check makes
    #    booleans arithmetic. `true + 1` is null in the reference.
    assert evaluate("f + 1", {"f": True}) is None
    assert evaluate("-f", {"f": True}) is None

    # 4. `1 == 1.0` must stay True -- JSON has one number type, and an int/float
    #    split is Python's representation detail, not a semantic difference.
    assert evaluate("n === 1", {"n": 1.0}) is True

    # No coercion in either spelling. Python gets this one right natively.
    assert evaluate("'3' === 3") is False
    assert evaluate("'3' == 3") is False


def test_short_circuit_returns_the_operand() -> None:
    # Python's own `and`/`or` do return the operand, so this is the one rule
    # Python would get right by instinct -- asserted anyway, because it is the
    # single most useful shape in the grammar and a refactor could lose it.
    assert evaluate("a || b", {"a": None, "b": "fallback"}) == "fallback"
    assert evaluate("a || b", {"a": "first", "b": "second"}) == "first"
    assert evaluate("a && b", {"a": "yes", "b": "second"}) == "second"
    assert evaluate("a && b", {"a": 0, "b": "unused"}) == 0

    # ...but Python's truthiness would break it for containers, where its `or`
    # would skip an empty list that this grammar considers a real value.
    assert evaluate("a || b", {"a": [], "b": "wrong"}) == []


def test_stringifies_numbers_the_way_json_does() -> None:
    # `str(3.0)` is '3.0' in Python and '3' in JavaScript. Two runtimes must
    # not build different strings from the same expression.
    assert evaluate("'n=' + n", {"n": 3.0}) == "n=3"
    assert evaluate("'n=' + n", {"n": 3}) == "n=3"
    assert evaluate("'n=' + n", {"n": 1.5}) == "n=1.5"
    assert evaluate("'f=' + f", {"f": True}) == "f=true"

    # None concatenates as a GAP, not as the word for absence.
    assert evaluate("'x' + n", {"n": None}) == "x"


def test_absence_and_malformity_stay_apart() -> None:
    # The reason the package exists, as one test.
    assert evaluate("in.nothing", {"in": {}}) is None
    with pytest.raises(ExprSyntaxError):
        evaluate("in.a &&", {"in": {}})


def test_the_sandbox_holds() -> None:
    # These expressions arrive from end users and from agents, over the wire.
    # Python's attribute surface is the richest of the three languages, so this
    # is the runtime where a lookup that fell through to `getattr` would be
    # most dangerous.
    assert evaluate("x.__class__", {"x": {}}) is None
    assert evaluate("x.__globals__", {"x": {}}) is None
    assert evaluate("x.constructor", {"x": {}}) is None
    assert evaluate("x.items", {"x": {}}) is None
    assert evaluate("x.keys", {"x": {}}) is None

    # A call does not even parse, so a host can reject one BEFORE it is saved
    # rather than sandboxing it at run time.
    for source in ("__import__('os')", "x.map(y)", "eval('1')", "print(1)"):
        with pytest.raises(ExprSyntaxError):
            evaluate(source, {"x": []})


def test_length_is_the_one_pseudo_property() -> None:
    assert evaluate("x.length", {"x": [1, 2]}) == 2
    assert evaluate("x.length", {"x": []}) == 0
    assert evaluate("s.length", {"s": "abc"}) == 3
    assert evaluate("o.length", {"o": {}}) is None
    assert evaluate("o.length", {"o": {"a": 1}}) is None
    assert evaluate("x.length === 0 ? 'empty' : 'has items'", {"x": []}) == "empty"


def test_arithmetic_and_comparison_edges() -> None:
    # Division by zero is null, not a raise and not infinity -- infinity cannot
    # survive the JSON round trip these expressions live inside.
    assert evaluate("1 / 0") is None
    assert evaluate("(1 + 2) * 2") == 6

    # A comparison with an absent operand is False, not an error. Safe only
    # because malformity still raises.
    assert evaluate("x > 5", {}) is False
    assert evaluate("x < 5", {}) is False


def test_computed_index_sees_the_context() -> None:
    # An index is an arbitrary expression evaluated against the SAME context.
    # Handing it an empty one would make every computed index absent and every
    # such expression quietly return null -- indistinguishable from a real miss.
    assert evaluate("items[i]", {"items": ["a", "b", "c"], "i": 1}) == "b"
    assert evaluate("items[i + 1]", {"items": ["a", "b", "c"], "i": 1}) == "c"
    assert evaluate("items[9]", {"items": ["a"]}) is None
