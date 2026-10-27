<?php

declare(strict_types=1);

namespace FancyExpr;

/**
 * The PHP implementation of the fancy-expr grammar.
 *
 * Built against `GRAMMAR.md` and the published `expr/evaluate` rows, NOT against
 * the TypeScript source. That ordering is the point: three existing expression
 * libraries disagree with each other, so the only version of this that can be
 * held to a contract is one grammar satisfied independently by each runtime.
 *
 * Where this file makes a choice a PHP author would question, the comment says
 * which row pins it — because the places three languages drift are exactly the
 * places an idiomatic local decision is wrong.
 */
final class Expr
{
    /** Multi-character operators, LONGEST FIRST. */
    private const PUNCT = [
        '===', '!==', '==', '!=', '<=', '>=', '&&', '||',
        '?', ':', '.', ',', '(', ')', '[', ']', '{', '}', '+', '-', '*', '/', '<', '>', '!',
    ];

    /** Longest accepted expression, in UTF-8 bytes. Inclusive. */
    public const MAX_EXPRESSION_BYTES = 8192;

    /**
     * Deepest accepted expression, by GRAMMAR.md's definition. Inclusive.
     *
     * Enforced twice against ONE definition: on the way down ({@see child()}),
     * so no input recurses past the limit before the parser knows; and on the
     * way up ({@see finish()}), because a binary chain is built in a loop but
     * makes a left-deep tree the evaluator recurses through.
     */
    public const MAX_EXPRESSION_DEPTH = 64;

    /**
     * Parse and evaluate. Throws {@see ExprSyntaxError} if it cannot parse.
     *
     * @param  array<string,mixed>  $context
     */
    public static function evaluate(string $expression, array $context = []): mixed
    {
        return self::evaluateNode(self::parse($expression), $context);
    }

    /**
     * Parse only — no data required.
     *
     * That is what lets a host ask "is this expression valid?" while a person is
     * still typing, and reject a node whose expression can never work at SAVE
     * time rather than discovering it mid-run.
     *
     * @return array<string,mixed> the AST
     */
    public static function parse(string $source): array
    {
        // GRAMMAR.md "Limits". Length FIRST, before a token is read (expr/limits
        // 0005). strlen() is bytes, which is the unit the grammar specifies --
        // the one place PHP's native length is already the right answer.
        if (strlen($source) > self::MAX_EXPRESSION_BYTES) {
            throw new ExprSyntaxError(
                sprintf('Expression too long: the limit is %d UTF-8 bytes', self::MAX_EXPRESSION_BYTES),
                $source,
                0,
                'EXPR_TOO_LONG',
            );
        }

        $tokens = self::tokenize($source);
        // `nest`: constructs enclosing the point being parsed. `depth`: depth of
        // the node most recently FINISHED, read by its parent straight after.
        $state = ['tokens' => $tokens, 'i' => 0, 'source' => $source, 'nest' => 0, 'depth' => 0];

        // An empty expression is malformed, not null. `{{ }}` says nothing, and
        // producing a value for it would be the same class of guess this package
        // exists to remove.
        if ($tokens[0]['type'] === 'eof') {
            throw new ExprSyntaxError('Empty expression', $source, 0);
        }

        $node = self::parseTernary($state);

        // Trailing junk is an error. Without this, `in.a in.b` would parse as
        // `in.a` and silently ignore the rest -- the easiest way for a typo to
        // become a wrong answer instead of a message.
        $rest = $state['tokens'][$state['i']];
        if ($rest['type'] !== 'eof') {
            throw new ExprSyntaxError(sprintf('Unexpected `%s`', $rest['value']), $source, $rest['at']);
        }

        return $node;
    }

    /**
     * The ROOT identifiers an expression reads — unique, sorted, no data needed.
     *
     * ## Why this exists
     *
     * A consumer reported that `{{ $now }}` renders as nothing. `$`-prefixed
     * roots read to an author as *engine-provided*, so agents reach for `$now`,
     * `$today` and `$index` the way they reach for the two that actually exist
     * — and a real document shipped titled `"Deal List Export -"` with the date
     * silently missing. Their observation is the one that mattered: an unknown
     * `$` root is detectable at PARSE time in a way `in.genuinely_absent` is
     * not.
     *
     * ## Why the check does not live in here
     *
     * This package cannot know whether `$now` exists. `$json`, `$input` and
     * `$props` are real in one host and meaningless in another, so an allowlist
     * here would be wrong for every host but one. It answers the only question
     * it can answer honestly and the HOST compares that against what it
     * provides:
     *
     * ```php
     * $unknown = array_diff(Expr::references($expr), $provided);
     * if ($unknown !== []) {
     *     throw new InvalidArgumentException('No such value: '.implode(', ', $unknown));
     * }
     * ```
     *
     * That also catches the second reported shape — `{{ n2.transcript }}`, a
     * real node id two hops upstream, legal-looking and resolving to nothing
     * because a node id addresses only a *direct* predecessor.
     *
     * It deliberately CANNOT catch `{{ in.output }}` — a real port with a field
     * that node never emits. The root is legitimate, so nothing static
     * separates an absent field from one absent *this run*.
     *
     * Throws on a malformed expression exactly as `parse()` does. Returning an
     * empty list there would tell a host "this needs nothing" and let it save a
     * node that can never run.
     *
     * @return list<string>
     */
    public static function references(string $expression): array
    {
        $found = [];
        self::collectReferences(self::parse($expression), $found);

        $roots = array_keys($found);
        // Sorted, not insertion-ordered: three languages must produce the SAME
        // list, and insertion order agrees with a sorted one often enough to
        // look correct and not always.
        sort($roots);

        return $roots;
    }

    /**
     * @param  array<string,mixed>  $node
     * @param  array<string,true>  $out
     */
    private static function collectReferences(array $node, array &$out): void
    {
        switch ($node['kind']) {
            case 'literal':
                return;

            case 'path':
                $segments = $node['segments'];
                // The head is the root; every later segment is a step INTO it,
                // and a named step is never a name the host has to supply.
                if (isset($segments[0]['name'])) {
                    $out[$segments[0]['name']] = true;
                }
                foreach (array_slice($segments, 1) as $segment) {
                    // A computed index IS a reference. `items[i]` reads `i`,
                    // and a typo'd index gets the same silent empty as `$now`.
                    if (isset($segment['expr'])) {
                        self::collectReferences($segment['expr'], $out);
                    }
                }

                return;

            case 'array':
                foreach ($node['items'] as $item) {
                    self::collectReferences($item, $out);
                }

                return;

            case 'object':
                // KEYS are written, not read. Collecting them would make a host
                // reject `{ transcript: in.content }` — a false rejection at
                // save time, which is the worse direction because the author
                // has no way to comply.
                foreach ($node['entries'] as $entry) {
                    self::collectReferences($entry['value'], $out);
                }

                return;

            case 'ternary':
                // Every branch, not only the one a run would take. A static
                // question has no run; short-circuiting here would approve an
                // expression that fails on the other road.
                self::collectReferences($node['test'], $out);
                self::collectReferences($node['then'], $out);
                self::collectReferences($node['other'], $out);

                return;

            case 'logical':
            case 'binary':
                self::collectReferences($node['left'], $out);
                self::collectReferences($node['right'], $out);

                return;

            case 'unary':
                self::collectReferences($node['operand'], $out);
        }
    }

    /**
     * Is this value truthy, by THIS grammar's rules rather than PHP's?
     *
     * Rows 0301-0305. The one that matters: `[]` is **TRUE** here, where PHP's
     * own `(bool) []` is false. The data arrived as JSON, where an array that
     * EXISTS is a value; whether it is empty is what `.length` asks. Conflating
     * the two turns "did we get results?" into "did the call succeed?", a check
     * that reads as correct until the day the list comes back empty.
     */
    public static function truthy(mixed $value): bool
    {
        if ($value === null) {
            return false;
        }
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value) || is_float($value)) {
            return $value != 0 && ! is_nan((float) $value);
        }
        if (is_string($value)) {
            return $value !== '';
        }

        return true; // arrays and objects, empty or not
    }

    // -- tokenizer ---------------------------------------------------------

    /** @return list<array{type:string,value:mixed,at:int}> */
    private static function tokenize(string $source): array
    {
        $tokens = [];
        $i = 0;
        $len = strlen($source);

        // Sorted here rather than in the constant: matching `=` before `===`
        // would silently split every strict comparison into two tokens, and a
        // literal-order constant makes that a one-character mistake away.
        $punct = self::PUNCT;
        usort($punct, static fn (string $a, string $b): int => strlen($b) <=> strlen($a));

        while ($i < $len) {
            $ch = $source[$i];

            if ($ch === ' ' || $ch === "\t" || $ch === "\n" || $ch === "\r") {
                $i++;

                continue;
            }

            if ($ch === "'" || $ch === '"') {
                $start = $i;
                $quote = $ch;
                $out = '';
                $i++;
                $closed = false;

                while ($i < $len) {
                    if ($source[$i] === '\\' && $i + 1 < $len) {
                        $out .= $source[$i + 1];
                        $i += 2;

                        continue;
                    }
                    if ($source[$i] === $quote) {
                        $i++;
                        $closed = true;
                        break;
                    }
                    $out .= $source[$i];
                    $i++;
                }

                if (! $closed) {
                    throw new ExprSyntaxError('Unterminated string', $source, $start);
                }
                $tokens[] = ['type' => 'string', 'value' => $out, 'at' => $start];

                continue;
            }

            if ($ch >= '0' && $ch <= '9') {
                $start = $i;
                while ($i < $len && $source[$i] >= '0' && $source[$i] <= '9') {
                    $i++;
                }
                $isFloat = false;
                if ($i < $len && $source[$i] === '.' && $i + 1 < $len && $source[$i + 1] >= '0' && $source[$i + 1] <= '9') {
                    $isFloat = true;
                    $i++;
                    while ($i < $len && $source[$i] >= '0' && $source[$i] <= '9') {
                        $i++;
                    }
                }
                $raw = substr($source, $start, $i - $start);
                $tokens[] = ['type' => 'number', 'value' => $isFloat ? (float) $raw : (int) $raw, 'at' => $start];

                continue;
            }

            if (preg_match('/[A-Za-z_$]/', $ch) === 1) {
                $start = $i;
                $i++;
                while ($i < $len && preg_match('/[A-Za-z0-9_$-]/', $source[$i]) === 1) {
                    $i++;
                }
                $tokens[] = ['type' => 'ident', 'value' => substr($source, $start, $i - $start), 'at' => $start];

                continue;
            }

            $matched = null;
            foreach ($punct as $p) {
                if (str_starts_with(substr($source, $i), $p)) {
                    $matched = $p;
                    break;
                }
            }

            if ($matched === null) {
                throw new ExprSyntaxError(sprintf('Unexpected character `%s`', $ch), $source, $i);
            }

            $tokens[] = ['type' => 'punct', 'value' => $matched, 'at' => $i];
            $i += strlen($matched);
        }

        $tokens[] = ['type' => 'eof', 'value' => '', 'at' => $len];

        return $tokens;
    }

    // -- parser ------------------------------------------------------------

    /** @param array<string,mixed> $s */
    private static function isPunct(array $s, string ...$values): bool
    {
        $t = $s['tokens'][$s['i']];

        return $t['type'] === 'punct' && in_array($t['value'], $values, true);
    }

    /** @param array<string,mixed> $s */
    private static function eat(array &$s, string $value): bool
    {
        if (self::isPunct($s, $value)) {
            $s['i']++;

            return true;
        }

        return false;
    }

    /** @param array<string,mixed> $s */
    private static function expect(array &$s, string $value): void
    {
        if (! self::eat($s, $value)) {
            $t = $s['tokens'][$s['i']];
            throw new ExprSyntaxError(sprintf('Expected `%s`', $value), $s['source'], $t['at']);
        }
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    /** @param  array<string,mixed>  $s */
    private static function tooDeep(array $s): ExprSyntaxError
    {
        return new ExprSyntaxError(
            sprintf('Expression nested too deeply: %d levels is the limit', self::MAX_EXPRESSION_DEPTH),
            $s['source'],
            $s['tokens'][$s['i']]['at'],
            'EXPR_TOO_DEEP',
        );
    }

    /**
     * Parse a CHILD of a construct. `nest` then counts every enclosing construct
     * including the parent, and the child is at least one level itself -- so
     * once `nest` reaches the limit the finished tree must exceed it, and
     * refusing now is the verdict finish() would reach, minus the recursion.
     *
     * @param  array<string,mixed>  $s
     * @param  callable(array<string,mixed>&): array<string,mixed>  $parse
     * @return array<string,mixed>
     */
    private static function child(array &$s, callable $parse): array
    {
        $s['nest']++;
        try {
            if ($s['nest'] >= self::MAX_EXPRESSION_DEPTH) {
                throw self::tooDeep($s);
            }

            return $parse($s);
        } finally {
            $s['nest']--;
        }
    }

    /**
     * Record a finished node's depth, refusing it past the limit.
     *
     * @param  array<string,mixed>  $s
     * @param  array<string,mixed>  $node
     * @return array<string,mixed>
     */
    private static function finish(array &$s, array $node, int $depth): array
    {
        if ($depth > self::MAX_EXPRESSION_DEPTH) {
            throw self::tooDeep($s);
        }
        $s['depth'] = $depth;

        return $node;
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parseTernary(array &$s): array
    {
        $test = self::parseOr($s);
        if (! self::eat($s, '?')) {
            return $test;
        }
        $testDepth = $s['depth'];

        $then = self::child($s, self::parseTernary(...));
        $thenDepth = $s['depth'];
        self::expect($s, ':');
        $other = self::child($s, self::parseTernary(...));

        return self::finish(
            $s,
            ['kind' => 'ternary', 'test' => $test, 'then' => $then, 'other' => $other],
            1 + max($testDepth, $thenDepth, $s['depth']),
        );
    }

    /**
     * One left-associative level. A LOOP, never recursion -- but each operator
     * wraps everything to its left, so a long chain is a deep tree.
     *
     * @param  array<string,mixed>  $s
     * @param  callable(array<string,mixed>&): array<string,mixed>  $operand
     * @param  callable(string, array<string,mixed>, array<string,mixed>): array<string,mixed>  $build
     * @return array<string,mixed>
     */
    private static function chain(array &$s, callable $operand, callable $build, string ...$ops): array
    {
        $left = $operand($s);
        while (self::isPunct($s, ...$ops)) {
            $raw = (string) $s['tokens'][$s['i']]['value'];
            $s['i']++;
            $leftDepth = $s['depth'];
            $right = $operand($s);
            $left = self::finish($s, $build($raw, $left, $right), 1 + max($leftDepth, $s['depth']));
        }

        return $left;
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parseOr(array &$s): array
    {
        return self::chain(
            $s,
            self::parseAnd(...),
            static fn (string $op, array $l, array $r): array => ['kind' => 'logical', 'op' => '||', 'left' => $l, 'right' => $r],
            '||',
        );
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parseAnd(array &$s): array
    {
        return self::chain(
            $s,
            self::parseEquality(...),
            static fn (string $op, array $l, array $r): array => ['kind' => 'logical', 'op' => '&&', 'left' => $l, 'right' => $r],
            '&&',
        );
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parseEquality(array &$s): array
    {
        // `==` and `===` collapse to ONE operator, and neither coerces
        // (rows 0501-0503). PHP's own `==` is the trap here: `'3' == 3` is
        // true natively, and a runtime that inherited that would disagree
        // with its twins on a shape authors write constantly.
        return self::chain(
            $s,
            self::parseComparison(...),
            static fn (string $raw, array $l, array $r): array => [
                'kind' => 'binary', 'op' => str_starts_with($raw, '!') ? '!==' : '===', 'left' => $l, 'right' => $r,
            ],
            '===', '==', '!==', '!=',
        );
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parseComparison(array &$s): array
    {
        return self::chain($s, self::parseAdditive(...), self::binaryNode(...), '<', '<=', '>', '>=');
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parseAdditive(array &$s): array
    {
        return self::chain($s, self::parseMultiplicative(...), self::binaryNode(...), '+', '-');
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parseMultiplicative(array &$s): array
    {
        return self::chain($s, self::parseUnary(...), self::binaryNode(...), '*', '/');
    }

    /**
     * @param  array<string,mixed>  $l
     * @param  array<string,mixed>  $r
     * @return array<string,mixed>
     */
    private static function binaryNode(string $op, array $l, array $r): array
    {
        return ['kind' => 'binary', 'op' => $op, 'left' => $l, 'right' => $r];
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parseUnary(array &$s): array
    {
        if (self::isPunct($s, '!', '-')) {
            $op = (string) $s['tokens'][$s['i']]['value'];
            $s['i']++;
            $operand = self::child($s, self::parseUnary(...));

            return self::finish($s, ['kind' => 'unary', 'op' => $op, 'operand' => $operand], 1 + $s['depth']);
        }

        return self::parsePrimary($s);
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parsePrimary(array &$s): array
    {
        $t = $s['tokens'][$s['i']];

        if ($t['type'] === 'number' || $t['type'] === 'string') {
            $s['i']++;

            return self::finish($s, ['kind' => 'literal', 'value' => $t['value']], 1);
        }

        if ($t['type'] === 'ident') {
            $name = (string) $t['value'];
            if ($name === 'true' || $name === 'false' || $name === 'null') {
                $s['i']++;

                return self::finish($s, ['kind' => 'literal', 'value' => $name === 'null' ? null : $name === 'true'], 1);
            }

            return self::parsePath($s);
        }

        if (self::eat($s, '(')) {
            // A group leaves no node but IS a level: the parser recurses through
            // it, and recursion is what the limit bounds (expr/limits 0102).
            $inner = self::child($s, self::parseTernary(...));
            self::expect($s, ')');

            return self::finish($s, $inner, 1 + $s['depth']);
        }

        if (self::eat($s, '[')) {
            $items = [];
            $deepest = 0;
            if (! self::isPunct($s, ']')) {
                do {
                    $items[] = self::child($s, self::parseTernary(...));
                    $deepest = max($deepest, $s['depth']);
                } while (self::eat($s, ','));
            }
            self::expect($s, ']');

            return self::finish($s, ['kind' => 'array', 'items' => $items], 1 + $deepest);
        }

        if (self::eat($s, '{')) {
            $entries = [];
            $deepest = 0;
            if (! self::isPunct($s, '}')) {
                do {
                    $k = $s['tokens'][$s['i']];
                    if ($k['type'] !== 'ident' && $k['type'] !== 'string') {
                        throw new ExprSyntaxError('Expected an object key', $s['source'], $k['at']);
                    }
                    $s['i']++;
                    self::expect($s, ':');
                    $entries[] = ['key' => (string) $k['value'], 'value' => self::child($s, self::parseTernary(...))];
                    $deepest = max($deepest, $s['depth']);
                } while (self::eat($s, ','));
            }
            self::expect($s, '}');

            return self::finish($s, ['kind' => 'object', 'entries' => $entries], 1 + $deepest);
        }

        throw new ExprSyntaxError(
            sprintf('Unexpected `%s`', $t['value'] === '' ? 'end of expression' : $t['value']),
            $s['source'],
            $t['at'],
        );
    }

    /**
     * @param  array<string,mixed>  $s
     * @return array<string,mixed>
     */
    private static function parsePath(array &$s): array
    {
        $segments = [];
        $head = $s['tokens'][$s['i']];
        $s['i']++;
        $segments[] = ['name' => (string) $head['value']];
        // Dot-segments nest nothing (expr/limits 0801); only a computed index
        // is a nested expression.
        $deepest = 0;

        for (;;) {
            if (self::eat($s, '.')) {
                $seg = $s['tokens'][$s['i']];
                if ($seg['type'] !== 'ident') {
                    throw new ExprSyntaxError('Expected a path segment', $s['source'], $seg['at']);
                }
                $s['i']++;
                $segments[] = ['name' => (string) $seg['value']];

                continue;
            }

            if (self::eat($s, '[')) {
                $idx = self::child($s, self::parseTernary(...));
                $deepest = max($deepest, $s['depth']);
                self::expect($s, ']');
                $segments[] = ['expr' => $idx];

                continue;
            }

            // A `(` here would be a function call. Refused DELIBERATELY: these
            // expressions arrive from end users and from agents, over the wire.
            // Sandboxing is a security property, not a style preference.
            if (self::isPunct($s, '(')) {
                throw new ExprSyntaxError(
                    'Function calls are not supported — this is an expression grammar, not a language',
                    $s['source'],
                    $s['tokens'][$s['i']]['at'],
                );
            }

            return self::finish($s, ['kind' => 'path', 'segments' => $segments], 1 + $deepest);
        }
    }

    // -- evaluator ---------------------------------------------------------

    /**
     * @param  array<string,mixed>  $node
     * @param  array<string,mixed>  $context
     */
    public static function evaluateNode(array $node, array $context): mixed
    {
        return match ($node['kind']) {
            'literal' => $node['value'],
            'path' => self::resolvePath($node, $context),
            'array' => array_map(static fn (array $n): mixed => self::evaluateNode($n, $context), $node['items']),
            'object' => self::evalObject($node, $context),
            'unary' => self::evalUnary($node, $context),
            'logical' => self::evalLogical($node, $context),
            'ternary' => self::truthy(self::evaluateNode($node['test'], $context))
                ? self::evaluateNode($node['then'], $context)
                : self::evaluateNode($node['other'], $context),
            'binary' => self::binary(
                $node['op'],
                self::evaluateNode($node['left'], $context),
                self::evaluateNode($node['right'], $context),
            ),
            default => null,
        };
    }

    /**
     * @param  array<string,mixed>  $node
     * @param  array<string,mixed>  $context
     * @return array<string,mixed>
     */
    private static function evalObject(array $node, array $context): array
    {
        $out = [];
        foreach ($node['entries'] as $entry) {
            $out[$entry['key']] = self::evaluateNode($entry['value'], $context);
        }

        return $out;
    }

    /**
     * @param  array<string,mixed>  $node
     * @param  array<string,mixed>  $context
     */
    private static function evalUnary(array $node, array $context): mixed
    {
        $v = self::evaluateNode($node['operand'], $context);

        if ($node['op'] === '!') {
            return ! self::truthy($v);
        }

        return is_int($v) || is_float($v) ? -$v : null;
    }

    /**
     * Returns the OPERAND, not a boolean (rows 0401-0404).
     *
     * That is what makes `in.transcript || in.content` a fallback rather than
     * merely `true` -- and a fallback is precisely the shape the reported
     * production graph wrote before this grammar existed.
     *
     * @param  array<string,mixed>  $node
     * @param  array<string,mixed>  $context
     */
    private static function evalLogical(array $node, array $context): mixed
    {
        $left = self::evaluateNode($node['left'], $context);

        if ($node['op'] === '&&') {
            return self::truthy($left) ? self::evaluateNode($node['right'], $context) : $left;
        }

        return self::truthy($left) ? $left : self::evaluateNode($node['right'], $context);
    }

    private static function binary(string $op, mixed $l, mixed $r): mixed
    {
        $num = static fn (mixed $v): bool => is_int($v) || is_float($v);
        $comparable = static fn (mixed $a, mixed $b): bool => ($num($a) && $num($b)) || (is_string($a) && is_string($b));

        return match ($op) {
            '===' => self::strictEquals($l, $r),
            '!==' => ! self::strictEquals($l, $r),
            '+' => match (true) {
                $num($l) && $num($r) => $l + $r,
                is_string($l) || is_string($r) => self::stringify($l).self::stringify($r),
                default => null,
            },
            '-' => $num($l) && $num($r) ? $l - $r : null,
            '*' => $num($l) && $num($r) ? $l * $r : null,
            // Division by zero yields null rather than INF or a throw: INF is
            // not representable in JSON, so returning it would produce a value
            // that cannot survive the round trip these expressions live in.
            '/' => $num($l) && $num($r) && $r != 0 ? $l / $r : null,
            '<' => $comparable($l, $r) && $l < $r,
            '<=' => $comparable($l, $r) && $l <= $r,
            '>' => $comparable($l, $r) && $l > $r,
            '>=' => $comparable($l, $r) && $l >= $r,
            default => null,
        };
    }

    /**
     * Deep, TYPE-STRICT equality.
     *
     * PHP's `==` would call `'3' == 3` true and `[1,2] == [1,2]` true; the first
     * is wrong for this grammar and the second is right. So neither native
     * operator does the job: `===` on arrays compares element-wise but also
     * requires matching key ORDER, which JSON does not guarantee for objects.
     * Hence the explicit walk.
     */
    private static function strictEquals(mixed $l, mixed $r): bool
    {
        if (is_array($l) && is_array($r)) {
            if (count($l) !== count($r)) {
                return false;
            }
            $lList = array_is_list($l);
            if ($lList !== array_is_list($r)) {
                return false;
            }
            foreach ($l as $k => $v) {
                if (! array_key_exists($k, $r) || ! self::strictEquals($v, $r[$k])) {
                    return false;
                }
            }

            return true;
        }

        if ((is_int($l) || is_float($l)) && (is_int($r) || is_float($r))) {
            // One numeric type in this grammar (JSON's), so 3 and 3.0 are the
            // same value even though PHP's `===` says otherwise.
            return $l == $r;
        }

        return $l === $r;
    }

    private static function stringify(mixed $v): string
    {
        if ($v === null) {
            return '';
        }
        if (is_string($v)) {
            return $v;
        }
        if (is_bool($v)) {
            return $v ? 'true' : 'false';
        }
        if (is_int($v) || is_float($v)) {
            return (string) $v;
        }

        return json_encode($v) ?: '';
    }

    /**
     * Walk a path, yielding `null` the moment it cannot continue.
     *
     * `null` here means ABSENT and is a legitimate answer (row 0103). It is NOT
     * the same as a malformed expression, which threw back in `parse()` and
     * never reached here. Keeping those distinct is why this package exists.
     *
     * @param  array<string,mixed>  $node
     * @param  array<string,mixed>  $context
     */
    private static function resolvePath(array $node, array $context): mixed
    {
        $cursor = $context;

        foreach ($node['segments'] as $segment) {
            if ($cursor === null) {
                return null;
            }

            $key = array_key_exists('name', $segment)
                ? $segment['name']
                : self::stringify(self::evaluateNode($segment['expr'], $context));

            // `.length` on an array or string is the ONE pseudo-property, and
            // it is load-bearing: because `[]` is TRUTHY, without this a
            // consumer has no way to ask whether a collection is empty. It is a
            // computed count, not host reach -- nothing is called.
            if (is_string($cursor) && $key === 'length') {
                $cursor = mb_strlen($cursor);

                continue;
            }

            if (is_array($cursor)) {
                if ($key === 'length' && array_is_list($cursor)) {
                    $cursor = count($cursor);

                    continue;
                }
                $cursor = array_key_exists($key, $cursor) ? $cursor[$key] : null;

                continue;
            }

            return null;
        }

        return $cursor;
    }
}
