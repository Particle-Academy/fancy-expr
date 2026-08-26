"""The evaluator.

Every rule here is a row in ``expr/evaluate`` in ``fancy-conformance``. Where
Python's own instincts differ from the grammar the table wins, and each such
place is marked -- because a divergence between the three runtimes is silent by
nature, and this file is where Python would introduce one.

Python's four traps, all handled below:

1. ``bool`` is a subclass of ``int``. ``isinstance(True, int)`` is True, so a
   naive numeric check makes ``true`` arithmetic and ``true === 1`` equal.
2. ``bool([])`` and ``bool({})`` are False. The grammar says both are TRUTHY.
3. ``1 == 1.0`` is True (correct here, JSON has one number type) but
   ``True == 1`` is ALSO True (wrong here).
4. ``str(3.0)`` is ``'3.0'`` where JavaScript prints ``3``. String concatenation
   has to print numbers the way JSON does or two runtimes produce different
   strings from the same expression.
"""

from __future__ import annotations

import json
import math
from typing import Any

from ._parse import parse

__all__ = ["evaluate", "evaluate_node", "truthy"]


def evaluate(expression: str, context: dict[str, Any] | None = None) -> Any:
    """Parse and evaluate one expression against ``context``.

    Raises ``ExprSyntaxError`` if the expression cannot PARSE. Returns ``None``
    when a path does not resolve -- those are different outcomes and the
    difference is the reason this package exists.
    """
    return evaluate_node(parse(expression), context or {})


def truthy(value: Any) -> bool:
    """The grammar's truthiness, which is NOT Python's.

    ``[]`` and ``{}`` are TRUE here. The data arrived as JSON: a list that
    exists is a value, and asking whether it is EMPTY is what ``.length`` is
    for. Conflating the two turns "did we get results?" into "did the call
    succeed?" -- a check that reads as correct until the day the list comes
    back empty (rows 0301-0302).
    """
    if value is None:
        return False
    # Before the numeric branch: `isinstance(False, int)` is True in Python, so
    # testing numbers first would work by accident here and break elsewhere.
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0 and not (isinstance(value, float) and math.isnan(value))
    if isinstance(value, str):
        return value != ""
    return True  # lists and dicts, empty or not


def evaluate_node(node: dict[str, Any], context: dict[str, Any]) -> Any:
    kind = node["kind"]

    if kind == "literal":
        return node["value"]

    if kind == "path":
        return _resolve_path(node, context)

    if kind == "array":
        return [evaluate_node(item, context) for item in node["items"]]

    if kind == "object":
        return {key: evaluate_node(value, context) for key, value in node["entries"]}

    if kind == "ternary":
        branch = node["then"] if truthy(evaluate_node(node["cond"], context)) else node["otherwise"]
        return evaluate_node(branch, context)

    if kind == "logical":
        left = evaluate_node(node["left"], context)
        # Returns the OPERAND, not a boolean (rows 0401-0404). That is what
        # makes `in.transcript || in.content` a fallback rather than merely
        # `True`, and the reported production case wrote exactly that shape.
        if node["op"] == "||":
            return left if truthy(left) else evaluate_node(node["right"], context)
        return evaluate_node(node["right"], context) if truthy(left) else left

    if kind == "unary":
        operand = evaluate_node(node["operand"], context)
        if node["op"] == "!":
            return not truthy(operand)
        return -operand if _numeric(operand) else None

    if kind == "binary":
        return _binary(
            node["op"],
            evaluate_node(node["left"], context),
            evaluate_node(node["right"], context),
        )

    raise AssertionError(f"Unknown node kind {kind!r}")


def _numeric(value: Any) -> bool:
    """A number, and NOT a bool.

    `isinstance(True, int)` is True in Python, so omitting the bool check makes
    `true + 1` evaluate to 2 in this runtime and `null` in the other two. Nothing
    in the table catches it, which is exactly why it is called out here.
    """
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _comparable(left: Any, right: Any) -> bool:
    return (_numeric(left) and _numeric(right)) or (
        isinstance(left, str) and isinstance(right, str)
    )


def _binary(op: str, left: Any, right: Any) -> Any:
    if op == "===":
        return _strict_equals(left, right)
    if op == "!==":
        return not _strict_equals(left, right)

    if op == "+":
        # Numbers add; anything involving a string concatenates (rows 0603-0604).
        if _numeric(left) and _numeric(right):
            return left + right
        if isinstance(left, str) or isinstance(right, str):
            return _stringify(left) + _stringify(right)
        return None

    if op == "-":
        return left - right if _numeric(left) and _numeric(right) else None
    if op == "*":
        return left * right if _numeric(left) and _numeric(right) else None
    if op == "/":
        # Division by zero is null rather than infinity or a raise: infinity is
        # not representable in JSON, so returning it produces a value that
        # cannot survive the round trip these expressions live inside.
        if _numeric(left) and _numeric(right) and right != 0:
            return left / right
        return None

    # Ordering compares two numbers or two strings. A mixed or absent operand is
    # False rather than an error -- a question with no answer should not take
    # down a run. Safe only because MALFORMITY still raises, so "the author
    # wrote nonsense" stays distinguishable from "the data did not arrive".
    if op in ("<", "<=", ">", ">="):
        if not _comparable(left, right):
            return False
        if op == "<":
            return left < right
        if op == "<=":
            return left <= right
        if op == ">":
            return left > right
        return left >= right

    raise AssertionError(f"Unknown operator {op!r}")


def _strict_equals(left: Any, right: Any) -> bool:
    """Deep, type-strict equality. Lists and dicts compare by structure.

    No coercion in either spelling: `'3' === 3` and `'3' == 3` are both False
    (row 0503). Python gets that one right natively and gets a different one
    wrong -- `True == 1` is True in Python and must be False here, or `flag ===
    1` answers differently in this runtime than in the other two.
    """
    if isinstance(left, bool) != isinstance(right, bool):
        return False
    if isinstance(left, bool):
        return left is right

    if _numeric(left) and _numeric(right):
        # `1 === 1.0` is TRUE. JSON has one number type and so does this
        # grammar; an int/float split is Python's representation detail, not a
        # semantic difference a consumer should ever see.
        return bool(left == right)

    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            _strict_equals(a, b) for a, b in zip(left, right, strict=True)
        )

    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(
            _strict_equals(v, right[k]) for k, v in left.items()
        )

    if type(left) is not type(right):
        return False

    return bool(left == right)


def _stringify(value: Any) -> str:
    """JSON's spelling of a value, not Python's.

    `None` becomes the EMPTY STRING rather than `'None'` or `'null'`, matching
    the reference: concatenating an absent field should leave a gap, not the
    word for absence. Booleans are `true`/`false`, and an integral float prints
    without its `.0` -- `str(3.0)` would be `'3.0'` here and `'3'` in the other
    two runtimes, from the same expression.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if math.isnan(value):
            return "NaN"
        if math.isinf(value):
            return "Infinity" if value > 0 else "-Infinity"
        if value.is_integer():
            return str(int(value))
        return repr(value)
    if isinstance(value, int):
        return str(value)
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _resolve_path(node: dict[str, Any], context: dict[str, Any]) -> Any:
    """Walk a path, yielding ``None`` the moment it cannot continue.

    ``None`` here means ABSENT and is a legitimate answer (row 0103) -- a field
    missing today may be present tomorrow. It is emphatically NOT the same as a
    malformed expression, which raised back in ``parse()`` and never reached
    here.

    Reads own keys only: no attributes, no methods, no dunder, no host reach.
    ``.length`` is the single exception and is a COMPUTED count rather than a
    lookup (rows 0901-0906).
    """
    # The ROOT is the first step, walked by the same code as every other. Giving
    # it a shortcut would be a second lookup path to keep in agreement with the
    # first, and one of them would eventually stop agreeing.
    cursor: Any = context

    for step in node["steps"]:
        if cursor is None:
            # Row 0105: walking THROUGH an absent value is absent, not a crash.
            return None

        if step["type"] == "prop":
            key = step["name"]
        else:
            # An index is an arbitrary expression evaluated against the SAME
            # context -- `items[i]` has to be able to see `i`. Handing it an
            # empty context would make every computed index absent, and every
            # such expression would quietly return null.
            key = _stringify_key(evaluate_node(step["expr"], context))

        # The one pseudo-property. Load-bearing rather than convenient: `[]` is
        # truthy, so without this there would be no way to ask whether a
        # collection is EMPTY. Objects deliberately have none -- no count would
        # survive three languages (rows 0904/0906).
        if key == "length" and isinstance(cursor, (str, list)):
            cursor = len(cursor)
            continue

        if isinstance(cursor, list):
            cursor = cursor[int(key)] if _index_in_range(key, cursor) else None
            continue

        # Row 0905, and the sandbox. A plain key lookup and nothing else --
        # `constructor`, `__class__`, `__globals__` and every method name
        # resolve to absent, because none of them is a key in the data.
        if isinstance(cursor, dict) and key in cursor:
            cursor = cursor[key]
            continue

        return None

    return cursor


def _stringify_key(value: Any) -> str:
    """A path step's key. Absent and null index as the empty string."""
    if _numeric(value):
        return _stringify(value)
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return value if isinstance(value, str) else _stringify(value)


def _index_in_range(key: str, items: list[Any]) -> bool:
    try:
        i = int(key)
    except ValueError:
        return False
    return 0 <= i < len(items)
