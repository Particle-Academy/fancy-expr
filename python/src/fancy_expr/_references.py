"""What an expression READS -- the static question, answered without any data."""

from __future__ import annotations

from typing import Any

from ._parse import parse

__all__ = ["references"]


def references(expression: str) -> list[str]:
    """The ROOT identifiers an expression reads -- unique and sorted.

    ## Why this exists

    A consumer reported that ``{{ $now }}`` renders as nothing. ``$``-prefixed
    roots read to an author as *engine-provided*, so agents reach for ``$now``,
    ``$today`` and ``$index`` the way they reach for the two that actually
    exist -- and a real document shipped titled ``"Deal List Export -"`` with
    the date silently missing. Their observation is the one that mattered: an
    unknown ``$`` root is detectable at PARSE time in a way
    ``in.genuinely_absent`` is not.

    ## Why the check does not live in here

    This package cannot know whether ``$now`` exists. ``$json``, ``$input`` and
    ``$props`` are real in one host and meaningless in another, so an allowlist
    here would be wrong for every host but one. It answers the only question it
    can answer honestly, and the HOST compares that against what it provides::

        unknown = set(references(expr)) - provided
        if unknown:
            raise ValueError(f"No such value: {', '.join(sorted(unknown))}")

    That also catches the second reported shape -- ``{{ n2.transcript }}``, a
    real node id two hops upstream, legal-looking and resolving to nothing
    because a node id addresses only a *direct* predecessor.

    It deliberately CANNOT catch ``{{ in.output }}`` -- a real port with a field
    that node never emits. The root is legitimate, so nothing static separates
    an absent field from one absent *this run*.

    Raises ``ExprSyntaxError`` on a malformed expression, exactly as ``parse``
    does. Returning ``[]`` there would tell a host "this needs nothing" and let
    it save a node that can never run.
    """
    found: set[str] = set()
    _collect(parse(expression), found)
    # Sorted, not set-ordered: three languages must produce the SAME list, and
    # Python's set iteration order is not even stable across strings.
    return sorted(found)


def _collect(node: dict[str, Any], out: set[str]) -> None:
    kind = node["kind"]

    if kind == "literal":
        return

    if kind == "path":
        steps = node["steps"]
        # The head is the root; every later step goes INTO it, and a named step
        # is never a name the host has to supply.
        if steps and steps[0]["type"] == "prop":
            out.add(steps[0]["name"])
        for step in steps[1:]:
            # A computed index IS a reference -- `items[i]` reads `i`, and a
            # typo'd index gets the same silent empty as `$now`.
            if step["type"] == "index":
                _collect(step["expr"], out)
        return

    if kind == "array":
        for item in node["items"]:
            _collect(item, out)
        return

    if kind == "object":
        # KEYS are written, not read. Collecting them would make a host reject
        # `{ transcript: in.content }` -- a false rejection at save time, the
        # worse direction because the author has no way to comply.
        for _key, value in node["entries"]:
            _collect(value, out)
        return

    if kind == "ternary":
        # Every branch, not only the one a run would take. A static question has
        # no run; short-circuiting here would approve an expression that fails
        # on the other road.
        _collect(node["cond"], out)
        _collect(node["then"], out)
        _collect(node["otherwise"], out)
        return

    if kind in ("logical", "binary"):
        _collect(node["left"], out)
        _collect(node["right"], out)
        return

    if kind == "unary":
        _collect(node["operand"], out)
        return

    raise AssertionError(f"Unknown node kind {kind!r}")
