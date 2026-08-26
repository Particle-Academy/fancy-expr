"""Recursive-descent parser producing a plain-dict AST.

Separable from evaluation on purpose: a host must be able to ask *"is this
expression valid?"* with no data at all, which is what makes a workflow node
carrying a broken expression rejectable at SAVE time rather than discovered
half-way through a run.
"""

from __future__ import annotations

from typing import Any

from ._tokenize import ExprSyntaxError, Token, tokenize

# Precedence, lowest to highest, exactly as GRAMMAR.md lists it:
#   ternary, ||, &&, equality, comparison, + -, * /, unary, primary


class _State:
    __slots__ = ("expression", "i", "tokens")

    def __init__(self, tokens: list[Token], expression: str) -> None:
        self.tokens = tokens
        self.i = 0
        self.expression = expression

    def peek(self) -> Token:
        return self.tokens[self.i]

    def next(self) -> Token:
        tok = self.tokens[self.i]
        self.i += 1
        return tok

    def fail(self, message: str) -> ExprSyntaxError:
        tok = self.peek()
        return ExprSyntaxError(message, tok.start, self.expression)


def parse(expression: str) -> dict[str, Any]:
    """Parse without evaluating. Raises ``ExprSyntaxError`` on anything malformed."""
    s = _State(tokenize(expression), expression)

    # Row 0804. An empty expression is malformed, not an empty value -- a host
    # asking "is this valid?" about a blank field must hear no.
    if s.peek().kind == "eof":
        raise ExprSyntaxError("Empty expression", 0, expression)

    node = _expression(s)

    if s.peek().kind != "eof":
        raise s.fail("Unexpected trailing input")

    return node


def _is_punct(s: _State, *values: str) -> bool:
    tok = s.peek()
    return tok.kind == "punct" and tok.value in values


def _expect_punct(s: _State, value: str) -> None:
    if not _is_punct(s, value):
        raise s.fail(f"Expected {value!r}")
    s.next()


def _expression(s: _State) -> dict[str, Any]:
    return _ternary(s)


def _ternary(s: _State) -> dict[str, Any]:
    cond = _or(s)
    if not _is_punct(s, "?"):
        return cond
    s.next()
    then = _expression(s)
    _expect_punct(s, ":")
    return {"kind": "ternary", "cond": cond, "then": then, "otherwise": _expression(s)}


def _or(s: _State) -> dict[str, Any]:
    left = _and(s)
    while _is_punct(s, "||"):
        s.next()
        left = {"kind": "logical", "op": "||", "left": left, "right": _and(s)}
    return left


def _and(s: _State) -> dict[str, Any]:
    left = _equality(s)
    while _is_punct(s, "&&"):
        s.next()
        left = {"kind": "logical", "op": "&&", "left": left, "right": _equality(s)}
    return left


def _equality(s: _State) -> dict[str, Any]:
    left = _comparison(s)
    while _is_punct(s, "==", "===", "!=", "!=="):
        # ONE operator. Both spellings collapse here, so no runtime can end up
        # with a subtly different `==` from the other two (rows 0501-0503).
        raw = s.next().value
        op = "===" if raw in ("==", "===") else "!=="
        left = {"kind": "binary", "op": op, "left": left, "right": _comparison(s)}
    return left


def _comparison(s: _State) -> dict[str, Any]:
    left = _additive(s)
    while _is_punct(s, "<", "<=", ">", ">="):
        op = s.next().value
        left = {"kind": "binary", "op": op, "left": left, "right": _additive(s)}
    return left


def _additive(s: _State) -> dict[str, Any]:
    left = _multiplicative(s)
    while _is_punct(s, "+", "-"):
        op = s.next().value
        left = {"kind": "binary", "op": op, "left": left, "right": _multiplicative(s)}
    return left


def _multiplicative(s: _State) -> dict[str, Any]:
    left = _unary(s)
    while _is_punct(s, "*", "/"):
        op = s.next().value
        left = {"kind": "binary", "op": op, "left": left, "right": _unary(s)}
    return left


def _unary(s: _State) -> dict[str, Any]:
    if _is_punct(s, "!", "-"):
        op = s.next().value
        return {"kind": "unary", "op": op, "operand": _unary(s)}
    return _primary(s)


def _primary(s: _State) -> dict[str, Any]:
    tok = s.peek()

    if tok.kind == "number" or tok.kind == "string":
        s.next()
        return {"kind": "literal", "value": tok.value}

    if tok.kind == "ident":
        if tok.value == "true":
            s.next()
            return {"kind": "literal", "value": True}
        if tok.value == "false":
            s.next()
            return {"kind": "literal", "value": False}
        if tok.value == "null":
            s.next()
            return {"kind": "literal", "value": None}
        return _path(s)

    if _is_punct(s, "("):
        s.next()
        node = _expression(s)
        # Row 0803. An unclosed paren is malformed; it is never "the rest is
        # implied".
        _expect_punct(s, ")")
        return node

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
            index = _expression(s)
            _expect_punct(s, "]")
            steps.append({"type": "index", "expr": index})
            continue

        # Row 0805, and the security boundary. A `(` after a path is a CALL, and
        # calls do not parse -- which is what lets a host reject one before it
        # is ever saved, rather than sandboxing it at run time.
        if _is_punct(s, "("):
            raise s.fail("Function calls are not permitted")

        return {"kind": "path", "steps": steps}


def _array(s: _State) -> dict[str, Any]:
    _expect_punct(s, "[")
    items: list[dict[str, Any]] = []

    if not _is_punct(s, "]"):
        items.append(_expression(s))
        while _is_punct(s, ","):
            s.next()
            items.append(_expression(s))

    _expect_punct(s, "]")
    return {"kind": "array", "items": items}


def _object(s: _State) -> dict[str, Any]:
    _expect_punct(s, "{")
    entries: list[tuple[str, dict[str, Any]]] = []

    if not _is_punct(s, "}"):
        entries.append(_entry(s))
        while _is_punct(s, ","):
            s.next()
            entries.append(_entry(s))

    _expect_punct(s, "}")
    return {"kind": "object", "entries": entries}


def _entry(s: _State) -> tuple[str, dict[str, Any]]:
    tok = s.peek()
    if tok.kind not in ("ident", "string"):
        raise s.fail("Expected an object key")
    s.next()
    _expect_punct(s, ":")
    return str(tok.value), _expression(s)
