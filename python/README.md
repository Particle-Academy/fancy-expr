# fancy-expr (Python)

A sandboxed expression evaluator — **one grammar, three implementations**
(TypeScript, PHP, Python), all asserted against the same fixture table.

```python
from fancy_expr import evaluate, parse, references

evaluate("in.transcript || in.content", {"in": {"content": "hi"}})  # 'hi'
evaluate("results.length === 0 ? 'none' : 'ok'", {"results": []})  # 'none'

parse("in.a &&")  # raises ExprSyntaxError — ask this at SAVE time
references("{ when: $now }")  # ['$now'] — and the HOST decides if that exists
```

## The one thing to know

**An unresolved path is `None`. A malformed expression RAISES.** Those are never
the same value.

That distinction is the whole reason this package exists. Its absence cost a
consumer a production workflow: a branch condition the engine could not evaluate
returned null, null read as false, and the graph took the wrong road on every
run — while reporting success, with no error and no log line.

## Where Python differs from the grammar

The four traps this port handles explicitly, because Python's instincts are the
most divergent of the three languages and every one of them is silent:

| Python | This grammar |
|---|---|
| `bool([])` and `bool({})` are `False` | `[]` and `{}` are **truthy** — an array that exists is a value; `.length` asks whether it is empty |
| `True == 1` is `True` | `flag === 1` is **false**; a bool is not a number |
| `isinstance(True, int)` is `True` | `true + 1` is `None`, not `2` |
| `str(3.0)` is `'3.0'` | `'n=' + 3.0` is `'n=3'`, the way JSON prints it |

## What it is not

Not a programming language. No user functions, no loops, no assignment, no
method calls, no attribute access, no `eval` and no `exec`. A call does not even
*parse*, so a host can reject one before saving.

Expressions arrive from end users and from agents, over the wire — the sandbox
is a security boundary, not a style preference. The package has **zero runtime
dependencies**, and that is a requirement rather than an accident.

## Read next

**`GRAMMAR.md`** in the repository root is the specification. The
implementations follow it, not each other.
