"""The input bounds, from GRAMMAR.md "Limits".

The authoritative rows are ``expr/limits`` in fancy-conformance (since 0.35.0),
and this repository pins 0.35.0: ``test_conformance.py`` runs all 27 of them
from the pinned checkout. This file keeps the probes the table cannot express --
the exported constants, a lone surrogate not crashing the byte count, the
message not quoting an oversized expression, and references() hitting the same
bounds -- plus a direct copy of the boundary checks, so a limit regression names
itself here as well as by case id. Every limit is asserted from BOTH sides:
refusing everything long or nested would pass the out-of-limit half alone.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

import fancy_expr
from fancy_expr import ExprSyntaxError, evaluate, parse, references


def code_of(expression: str, context: dict[str, Any] | None = None) -> str:
    try:
        evaluate(expression, context or {})
    except ExprSyntaxError as error:
        return error.code
    return "OK"


def test_the_limits_are_the_documented_ones() -> None:
    assert fancy_expr.MAX_EXPRESSION_BYTES == 8192
    assert fancy_expr.MAX_EXPRESSION_DEPTH == 64


def test_accepts_exactly_8192_bytes_and_refuses_8193() -> None:
    assert evaluate("1" + " " * 8191) == 1
    assert code_of("1" + " " * 8192) == "EXPR_TOO_LONG"


def test_counts_utf8_bytes_not_code_points() -> None:
    assert code_of("'" + "é" * 4096 + "'") == "EXPR_TOO_LONG"
    assert evaluate("'" + "é" * 4095 + "'") == "é" * 4095


def test_a_lone_surrogate_counts_and_does_not_crash_the_count() -> None:
    # A JSON string can carry one; encode('utf-8') would raise on it.
    assert code_of("'" + "\ud800" * 2731 + "'") == "EXPR_TOO_LONG"


def test_checks_length_before_tokenizing() -> None:
    assert code_of("@" * 8193) == "EXPR_TOO_LONG"


def test_does_not_put_an_oversized_expression_in_the_message() -> None:
    with pytest.raises(ExprSyntaxError) as caught:
        parse("1" + " " * 9000)
    assert len(str(caught.value)) < 200


SHAPES: list[tuple[str, Callable[[int], str], int]] = [
    ("parentheses", lambda n: "(" * n + "1" + ")" * n, 63),
    ("unary", lambda n: "!" * n + "true", 63),
    ("binary chain", lambda n: "+".join(["1"] * (n + 1)), 63),
    ("arrays", lambda n: "[" * n + "]" * n, 64),
    ("objects", lambda n: "{a:" * n + "1" + "}" * n, 63),
    ("indices", lambda n: "x[" * n + "0" + "]" * n, 63),
    ("ternaries", lambda n: "false ? 0 : " * n + "1", 63),
]


@pytest.mark.parametrize(("name", "build", "at_limit"), SHAPES, ids=[s[0] for s in SHAPES])
def test_depth_limit_from_both_sides(name: str, build: Callable[[int], str], at_limit: int) -> None:
    assert code_of(build(at_limit), {"x": [0]}) == "OK"
    assert code_of(build(at_limit + 1), {"x": [0]}) == "EXPR_TOO_DEEP"


def test_refuses_the_stack_overflow_shapes_with_its_own_error() -> None:
    assert code_of("(" * 4000 + "1" + ")" * 4000) == "EXPR_TOO_DEEP"
    assert code_of("(" * 8000) == "EXPR_TOO_DEEP"
    assert code_of("+".join(["1"] * 4000)) == "EXPR_TOO_DEEP"


def test_does_not_count_dot_segments_or_width() -> None:
    assert evaluate("a" + ".b" * 500) is None
    assert len(evaluate("[" + ",".join(["1"] * 1000) + "]")) == 1000


def test_applies_to_references_too() -> None:
    with pytest.raises(ExprSyntaxError):
        references("(" * 8000)


def test_every_other_parse_failure_is_expr_syntax() -> None:
    assert code_of("in.a &&") == "EXPR_SYNTAX"
    assert code_of("'unterminated") == "EXPR_SYNTAX"
    assert code_of("f()") == "EXPR_SYNTAX"
