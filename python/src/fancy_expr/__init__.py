"""fancy-expr -- a sandboxed expression evaluator.

One grammar, three implementations (TypeScript, PHP, Python), all asserted
against the same fixture table in ``fancy-conformance``. ``GRAMMAR.md`` in the
repository root is the specification; this module follows it, not the other two
implementations.

    >>> from fancy_expr import evaluate
    >>> evaluate("in.transcript || in.content", {"in": {"content": "hi"}})
    'hi'
    >>> evaluate("results.length === 0 ? 'none' : 'ok'", {"results": []})
    'none'

**An unresolved path is ``None``. A malformed expression RAISES.** Those are
never the same outcome. Collapsing them cost a consumer a production workflow:
a branch condition the engine could not evaluate returned null, null read as
false, and the graph took the wrong road on every run while reporting success.

Nothing here reaches the host. No ``eval``, no ``exec``, no imports, no
attribute access, no calls of any kind -- and a call does not even PARSE, so a
host can reject one at save time. These expressions arrive from end users and
from agents, over the wire.
"""

from ._evaluate import evaluate, evaluate_node, truthy
from ._parse import parse
from ._references import references
from ._tokenize import ExprSyntaxError, tokenize

__all__ = [
    "ExprSyntaxError",
    "evaluate",
    "evaluate_node",
    "parse",
    "references",
    "tokenize",
    "truthy",
]

__version__ = "0.1.0"
