"""`expr/references` -- the static question, run against the Python implementation.

Same discipline as the evaluate table: the rows were published before this
function existed here, and it was written against them.
"""

from __future__ import annotations

from typing import Any

import pytest
from fancy_conformance import format_summary, run_table

from fancy_expr import ExprSyntaxError, references


def run_reference_case(case: dict[str, Any]) -> dict[str, Any]:
    try:
        return {"ok": True, "value": references(case["input"]["expression"])}
    except ExprSyntaxError:
        return {"ok": False}


def test_matches_the_table_on_every_case(capsys: pytest.CaptureFixture[str]) -> None:
    summary = run_table("expr/references", run_reference_case)

    with capsys.disabled():
        print("\n" + format_summary(summary))

    failures = [r["id"] for r in summary["results"] if r["status"] == "fail"]
    assert failures == [], f"Python disagrees on: {', '.join(failures)}"
    assert summary["failed"] == 0

    # The vacuity floor. A suite that loaded nothing reports zero failures too.
    assert summary["passed"] > 8


def test_is_enough_to_reject_the_reported_dollar_now() -> None:
    # The consumer's case, written the way a host actually would. `$now` looks
    # exactly as valid as `$json` to an author, and shipped a document titled
    # "Deal List Export -" with the date silently missing.
    provided = {"in", "$json", "$input", "$props"}

    def unknown(expr: str) -> list[str]:
        return sorted(set(references(expr)) - provided)

    assert unknown("'Deal List Export - ' + $now") == ["$now"]
    assert unknown("'Deal List Export - ' + $json.date") == []

    # The second reported shape: a REAL node id two hops upstream. Legal-looking,
    # resolves to nothing. One primitive, both shapes.
    assert sorted(set(references("n2.transcript")) - {"in", "n5"}) == ["n2"]


def test_cannot_catch_a_real_root_with_a_field_never_emitted() -> None:
    # The boundary, asserted rather than left to be discovered.
    assert references("in.output") == ["in"]


def test_resists_what_a_plausible_implementation_would_get_wrong() -> None:
    # Object KEYS are written, not read. Reporting them would make a host reject
    # a VALID expression, and the author would have no way to comply.
    assert references("{ transcript: in.content, source: 'manual' }") == ["in"]

    # Every branch, not only the one a run would take.
    assert references("a ? b : c") == ["a", "b", "c"]
    assert references("a || b") == ["a", "b"]

    # A computed index counts; a named step and a literal index do not.
    assert references("items[i]") == ["i", "items"]
    assert references("items[0]") == ["items"]
    assert references("items.length") == ["items"]

    # Malformed RAISES rather than returning []. An empty list would tell a host
    # "this expression needs nothing" and let it save an unrunnable node.
    with pytest.raises(ExprSyntaxError):
        references("in.a &&")
    with pytest.raises(ExprSyntaxError):
        references("")


def test_sorted_not_insertion_ordered() -> None:
    # Python's set iteration order is not stable across strings, so an
    # implementation returning `list(found)` would agree with the table on some
    # runs and not others -- a flake that reads as an unrelated failure.
    assert references("user.name + in.a + in.b + user.id") == ["in", "user"]
    assert references("z + y + x") == ["x", "y", "z"]
