"""The tokenizer.

Hand-written, like the other two implementations, and for the same reason: the
three standard libraries in this space disagree with each other on the semantics
in ``GRAMMAR.md``, so adopting one would ship a fourth dialect rather than a
third implementation of one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

TokenKind = Literal["number", "string", "ident", "punct", "eof"]

# Longest-first. `===` must be tried before `==`, and `!==` before `!=` and `!`,
# or the tokenizer splits a valid operator into two invalid ones and the error
# points at the wrong offset.
_PUNCT: tuple[str, ...] = (
    "===",
    "!==",
    "==",
    "!=",
    "&&",
    "||",
    "<=",
    ">=",
    "?",
    ":",
    ".",
    ",",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    "+",
    "-",
    "*",
    "/",
    "<",
    ">",
    "!",
)

_IDENT_START = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$")
_IDENT_REST = _IDENT_START | set("0123456789")
_DIGITS = set("0123456789")


class ExprSyntaxError(ValueError):
    """A malformed expression.

    NEVER conflate this with a ``None`` result. An unresolved path is ``None``
    and means *absent*; this means the author wrote something the grammar cannot
    read. Collapsing the two is the defect this package exists to remove -- a
    branch condition that could not be evaluated read as ``False`` and a live
    workflow took the wrong road on every run while reporting success.
    """

    def __init__(self, message: str, offset: int, expression: str) -> None:
        super().__init__(f"{message} (at offset {offset} in {expression!r})")
        self.offset = offset
        self.expression = expression


@dataclass(frozen=True, slots=True)
class Token:
    kind: TokenKind
    value: Any
    start: int


def tokenize(expression: str) -> list[Token]:
    tokens: list[Token] = []
    i = 0
    n = len(expression)

    while i < n:
        ch = expression[i]

        if ch in " \t\r\n":
            i += 1
            continue

        if ch in ("'", '"'):
            start = i
            text, i = _read_string(expression, i)
            tokens.append(Token("string", text, start))
            continue

        # A leading `.` on a number is NOT accepted: `.5` would be ambiguous
        # with the member operator, and every path segment begins with an
        # identifier character.
        if ch in _DIGITS:
            start = i
            number, i = _read_number(expression, i)
            tokens.append(Token("number", number, start))
            continue

        if ch in _IDENT_START:
            start = i
            while i < n and expression[i] in _IDENT_REST:
                i += 1
            tokens.append(Token("ident", expression[start:i], start))
            continue

        for p in _PUNCT:
            if expression.startswith(p, i):
                tokens.append(Token("punct", p, i))
                i += len(p)
                break
        else:
            raise ExprSyntaxError(f"Unexpected character {ch!r}", i, expression)

    tokens.append(Token("eof", None, n))
    return tokens


def _read_string(expression: str, i: int) -> tuple[str, int]:
    quote = expression[i]
    start = i
    i += 1
    out: list[str] = []

    while i < len(expression):
        ch = expression[i]

        if ch == "\\":
            if i + 1 >= len(expression):
                raise ExprSyntaxError("Unterminated escape", i, expression)
            nxt = expression[i + 1]
            out.append(
                {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", "'": "'", '"': '"'}.get(nxt, nxt)
            )
            i += 2
            continue

        if ch == quote:
            return "".join(out), i + 1

        out.append(ch)
        i += 1

    # Row 0801. An unclosed string is the most common malformed expression there
    # is, and it MUST reach the caller as a failure rather than as a value.
    raise ExprSyntaxError("Unterminated string", start, expression)


def _read_number(expression: str, i: int) -> tuple[float | int, int]:
    start = i
    n = len(expression)

    while i < n and expression[i] in _DIGITS:
        i += 1

    is_float = False

    if i < n and expression[i] == "." and i + 1 < n and expression[i + 1] in _DIGITS:
        is_float = True
        i += 1
        while i < n and expression[i] in _DIGITS:
            i += 1

    if i < n and expression[i] in "eE":
        j = i + 1
        if j < n and expression[j] in "+-":
            j += 1
        if j < n and expression[j] in _DIGITS:
            is_float = True
            i = j
            while i < n and expression[i] in _DIGITS:
                i += 1

    text = expression[start:i]

    # An integral literal stays an `int`. JSON has one number type and so does
    # this grammar, but Python prints `4` and `4.0` differently and the goldens
    # are written the way JSON writes them -- `in.count + 1` is `4`, not `4.0`.
    return (float(text) if is_float else int(text)), i
