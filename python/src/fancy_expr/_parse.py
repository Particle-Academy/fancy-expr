"""Recursive-descent parser producing a plain-dict AST.

Separable from evaluation on purpose: a host must be able to ask *"is this
expression valid?"* with no data at all, which is what makes a workflow node
carrying a broken expression rejectable at SAVE time rather than discovered
half-way through a run.

Bounded, because the input is hostile by assumption (GRAMMAR.md "Limits"): at
most ``MAX_EXPRESSION_BYTES`` UTF-8 bytes and a nesting depth of at most
``MAX_EXPRESSION_DEPTH``. Without them ``((((...`` from an end user raised
``RecursionError`` -- not ``ExprSyntaxError`` -- so a host validating at save
time crashed instead of refusing. Depth is enforced twice against ONE
definition: on the way DOWN (``_enter``), so no input recurses past the limit
before the parser knows; and on the way UP (``_finish``), because a binary chain
is built in a loop but makes a left-deep tree the evaluator recurses through.
"""

from __future__ import annotations

from typing import Any

from ._tokenize import ExprSyntaxError, Token, tokenize

#: Longest accepted expression, in UTF-8 bytes. Inclusive.
MAX_EXPRESSION_BYTES = 8192

#: Deepest accepted expression, by GRAMMAR.md's definition. Inclusive.
#:
#: Also what keeps Python's default recursion limit (1000) safe: the deepest
#: parse is about eleven frames per level, so 64 levels stay well under it.
MAX_EXPRESSION_DEPTH = 64

# Precedence, lowest to highest, exactly as GRAMMAR.md lists it:
#   ternary, ||, &&, equality, comparison, + -, * /, unary, primary


class _State:
    # `nest`: constructs enclosing the point being parsed. `depth`: depth of the
    # node most recently FINISHED, read by its parent straight after.
    __slots__ = ("depth", "expression", "i", "nest", "tokens")

    def __init__(self, tokens: list[Token], expression: str) -> None:
        self.tokens = tokens
        self.i = 0
        self.expression = expression
        self.nest = 0
        self.depth = 0

    def peek(self) -> Token:
        return self.tokens[self.i]

    def next(self) -> Token:
        tok = self.tokens[self.i]
        self.i += 1
        return tok

    def fail(self, message: str) -> ExprSyntaxError:
        tok = self.peek()
        return ExprSyntaxError(message, tok.start, self.expression)


def _utf8_length(expression: str) -> int:
    # `surrogatepass`: a lone surrogate can arrive inside a JSON string, and a
    # plain encode() would raise on it rather than measure it. It counts three
    # bytes, as the other two runtimes see it.
    return len(expression.encode("utf-8", "surrogatepass"))


def parse(expression: str) -> dict[str, Any]:
    """Parse without evaluating. Raises ``ExprSyntaxError`` on anything malformed."""
    # Length FIRST, before a token is read (expr/limits 0005). Every code point
    # is 1-4 bytes, so most inputs are settled without encoding anything.
    n = len(expression)
    limit = MAX_EXPRESSION_BYTES
    if n > limit or (n * 4 > limit and _utf8_length(expression) > limit):
        raise ExprSyntaxError(
            f"Expression too long: the limit is {MAX_EXPRESSION_BYTES} UTF-8 bytes",
            0,
            expression,
            "EXPR_TOO_LONG",
        )

    s = _State(tokenize(expression), expression)

    # Row 0804. An empty expression is malformed, not an empty value -- a host
    # asking "is this valid?" about a blank field must hear no.
    if s.peek().kind == "eof":
        raise ExprSyntaxError("Empty expression", 0, expression)

    node = _ternary(s)

    if s.peek().kind != "eof":
        raise s.fail("Unexpected trailing input")

    return node


def _too_deep(s: _State) -> ExprSyntaxError:
    return ExprSyntaxError(
        f"Expression nested too deeply: {MAX_EXPRESSION_DEPTH} levels is the limit",
        s.peek().start,
        s.expression,
        "EXPR_TOO_DEEP",
    )


def _enter(s: _State) -> None:
    """About to parse a CHILD of a construct.

    ``nest`` then counts every enclosing construct including the parent, and the
    child is at least one level itself -- so once ``nest`` reaches the limit the
    finished tree must exceed it, and refusing now is the verdict ``_finish``
    would reach, minus the recursion. Paired with ``s.nest -= 1`` after the
    child returns; on a raise the whole parse is abandoned, so no unwinding is
    needed. Not a wrapper around the call, on purpose: a wrapper is one more
    stack frame per level.
    """
    s.nest += 1
    if s.nest >= MAX_EXPRESSION_DEPTH:
        raise _too_deep(s)


def _finish(s: _State, node: dict[str, Any], depth: int) -> dict[str, Any]:
    if depth > MAX_EXPRESSION_DEPTH:
        raise _too_deep(s)
    s.depth = depth
    return node


def _join(
    s: _State,
    kind: str,
    op: str,
    left: dict[str, Any],
    left_depth: int,
    right: dict[str, Any],
) -> dict[str, Any]:
    """One link of a left-associative chain. The chain is a LOOP -- it never
    recurses -- but each operator wraps everything to its left, so a long chain
    is a deep tree and is measured here."""
    node = {"kind": kind, "op": op, "left": left, "right": right}
    return _finish(s, node, 1 + max(left_depth, s.depth))


def _is_punct(s: _State, *values: str) -> bool:
    tok = s.peek()
    return tok.kind == "punct" and tok.value in values


def _expect_punct(s: _State, value: str) -> None:
    if not _is_punct(s, value):
        raise s.fail(f"Expected {value!r}")
    s.next()


def _child(s: _State) -> dict[str, Any]:
    _enter(s)
    node = _ternary(s)
    s.nest -= 1
    return node


def _ternary(s: _State) -> dict[str, Any]:
    cond = _or(s)
    if not _is_punct(s, "?"):
        return cond
    cond_depth = s.depth
    s.next()
    then = _child(s)
    then_depth = s.depth
    _expect_punct(s, ":")
    otherwise = _child(s)
    return _finish(
        s,
        {"kind": "ternary", "cond": cond, "then": then, "otherwise": otherwise},
        1 + max(cond_depth, then_depth, s.depth),
    )


def _or(s: _State) -> dict[str, Any]:
    left = _and(s)
    while _is_punct(s, "||"):
        s.next()
        left_depth = s.depth
        right = _and(s)
        left = _join(s, "logical", "||", left, left_depth, right)
    return left


def _and(s: _State) -> dict[str, Any]:
    left = _equality(s)
    while _is_punct(s, "&&"):
        s.next()
        left_depth = s.depth
        right = _equality(s)
        left = _join(s, "logical", "&&", left, left_depth, right)
    return left


def _equality(s: _State) -> dict[str, Any]:
    left = _comparison(s)
    while _is_punct(s, "==", "===", "!=", "!=="):
        # ONE operator. Both spellings collapse here, so no runtime can end up
        # with a subtly different `==` from the other two (rows 0501-0503).
        raw = s.next().value
        op = "===" if raw in ("==", "===") else "!=="
        left_depth = s.depth
        right = _comparison(s)
        left = _join(s, "binary", op, left, left_depth, right)
    return left


def _comparison(s: _State) -> dict[str, Any]:
    left = _additive(s)
    while _is_punct(s, "<", "<=", ">", ">="):
        op = s.next().value
        left_depth = s.depth
        right = _additive(s)
        left = _join(s, "binary", op, left, left_depth, right)
    return left


def _additive(s: _State) -> dict[str, Any]:
    left = _multiplicative(s)
    while _is_punct(s, "+", "-"):
        op = s.next().value
        left_depth = s.depth
        right = _multiplicative(s)
        left = _join(s, "binary", op, left, left_depth, right)
    return left


def _multiplicative(s: _State) -> dict[str, Any]:
    left = _unary(s)
    while _is_punct(s, "*", "/"):
        op = s.next().value
        left_depth = s.depth
        right = _unary(s)
        left = _join(s, "binary", op, left, left_depth, right)
    return left


def _unary(s: _State) -> dict[str, Any]:
    if _is_punct(s, "!", "-"):
        op = s.next().value
        _enter(s)
        operand = _unary(s)
        s.nest -= 1
        return _finish(s, {"kind": "unary", "op": op, "operand": operand}, 1 + s.depth)
    return _primary(s)


def _primary(s: _State) -> dict[str, Any]:
    tok = s.peek()

    if tok.kind == "number" or tok.kind == "string":
        s.next()
        return _finish(s, {"kind": "literal", "value": tok.value}, 1)

    if tok.kind == "ident":
        if tok.value == "true":
            s.next()
            return _finish(s, {"kind": "literal", "value": True}, 1)
        if tok.value == "false":
            s.next()
            return _finish(s, {"kind": "literal", "value": False}, 1)
        if tok.value == "null":
            s.next()
            return _finish(s, {"kind": "literal", "value": None}, 1)
        return _path(s)

    if _is_punct(s, "("):
        s.next()
        # A group leaves no node but IS a level: the parser recurses through it,
        # and recursion is what the limit bounds (expr/limits 0102).
        node = _child(s)
        # Row 0803. An unclosed paren is malformed; it is never "the rest is
        # implied".
        _expect_punct(s, ")")
        return _finish(s, node, 1 + s.depth)

    if _is_punct(s, "["):
        return _array(s)

    if _is_punct(s, "{"):
        return _object(s)

    # Row 0802 lands here: a dangling operator leaves nothing for the operand.
    raise s.fail("Expected an expression")


def _path(s: _State) -> dict[str, Any]:
    root = s.next().value

    # The root is the FIRST step, not a special case beside them. One lookup
    # path is one thing to keep correct; two eventually stop agreeing.
    steps: list[dict[str, Any]] = [{"type": "prop", "name": root}]
    # Dot-steps nest nothing (expr/limits 0801); only a computed index is a
    # nested expression.
    deepest = 0

    while True:
        if _is_punct(s, "."):
            s.next()
            tok = s.peek()
            if tok.kind != "ident":
                raise s.fail("Expected a property name after '.'")
            s.next()
            steps.append({"type": "prop", "name": tok.value})
            continue

        if _is_punct(s, "["):
            s.next()
            index = _child(s)
            deepest = max(deepest, s.depth)
            _expect_punct(s, "]")
            steps.append({"type": "index", "expr": index})
            continue

        # Row 0805, and the security boundary. A `(` after a path is a CALL, and
        # calls do not parse -- which is what lets a host reject one before it
        # is ever saved, rather than sandboxing it at run time.
        if _is_punct(s, "("):
            raise s.fail("Function calls are not permitted")

        return _finish(s, {"kind": "path", "steps": steps}, 1 + deepest)


def _array(s: _State) -> dict[str, Any]:
    _expect_punct(s, "[")
    items: list[dict[str, Any]] = []
    deepest = 0

    if not _is_punct(s, "]"):
        items.append(_child(s))
        deepest = s.depth
        while _is_punct(s, ","):
            s.next()
            items.append(_child(s))
            deepest = max(deepest, s.depth)

    _expect_punct(s, "]")
    return _finish(s, {"kind": "array", "items": items}, 1 + deepest)


def _object(s: _State) -> dict[str, Any]:
    _expect_punct(s, "{")
    entries: list[tuple[str, dict[str, Any]]] = []
    deepest = 0

    if not _is_punct(s, "}"):
        entries.append(_entry(s))
        deepest = s.depth
        while _is_punct(s, ","):
            s.next()
            entries.append(_entry(s))
            deepest = max(deepest, s.depth)

    _expect_punct(s, "}")
    return _finish(s, {"kind": "object", "entries": entries}, 1 + deepest)


def _entry(s: _State) -> tuple[str, dict[str, Any]]:
    tok = s.peek()
    if tok.kind not in ("ident", "string"):
        raise s.fail("Expected an object key")
    s.next()
    _expect_punct(s, ":")
    return str(tok.value), _child(s)
