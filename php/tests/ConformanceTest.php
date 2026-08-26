<?php

declare(strict_types=1);

use FancyExpr\Expr;
use FancyExpr\ExprSyntaxError;
use ParticleAcademy\Conformance\Conformance;

/*
 * The shared grammar table, run against the PHP implementation.
 *
 * These rows were published BEFORE any implementation existed, and this port was
 * written against THEM rather than against the TypeScript source. That is the
 * whole argument for owning the grammar: symfony/expression-language, expr-eval
 * and simpleeval are all real and current and disagree with each other on
 * exactly the semantics below.
 *
 * PHP is the runtime most likely to drift here, and the table knows it:
 *
 *  - `(bool) []` is FALSE natively; this grammar says TRUE (0301).
 *  - `'3' == 3` is TRUE natively; this grammar says false (0503).
 *  - `[1,2] === [1,2]` is true natively but ORDER-SENSITIVE for string keys,
 *    which JSON does not guarantee -- hence the explicit walk.
 */

/**
 * @param  array<string,mixed>  $case
 * @return array<string,mixed>
 */
function runExprCase(array $case): array
{
    try {
        $value = Expr::evaluate(
            $case['input']['expression'],
            $case['input']['context'] ?? [],
        );
    } catch (ExprSyntaxError) {
        // Malformed. NEVER null -- a null here would be indistinguishable from
        // an absent path, which is the defect this package removes.
        return ['ok' => false];
    }

    return ['ok' => true, 'value' => $value];
}

it('matches the expr/evaluate table on every case', function (): void {
    $summary = Conformance::runTable('expr/evaluate', runExprCase(...));

    echo "\n".Conformance::formatSummary($summary)."\n";

    $failures = array_filter(
        $summary['results'] ?? [],
        static fn (array $r): bool => ($r['status'] ?? '') === 'fail',
    );

    expect($failures)->toBe([], 'PHP disagrees with the shared grammar on: '.implode(
        ', ',
        array_column($failures, 'id'),
    ));

    expect($summary['failed'])->toBe(0);

    // The vacuity floor. A suite that loaded nothing reports zero failures too.
    expect($summary['passed'])->toBeGreaterThan(40);
});

it('resists the three things PHP would natively do differently', function (): void {
    // The discrimination probes, aimed at THIS language's instincts rather than
    // at the grammar in general. Each one is a place a competent PHP author
    // would reasonably write something else and be silently incompatible with
    // the other two runtimes.

    // 1. `(bool) []` is false in PHP. Here an array that EXISTS is a value.
    expect(Expr::truthy([]))->toBeTrue();
    expect(Expr::truthy(new stdClass))->toBeTrue();
    expect(Expr::truthy(''))->toBeFalse();
    expect(Expr::truthy('0'))->toBeTrue();   // PHP's other famous trap
    expect(Expr::truthy(0))->toBeFalse();

    // 2. `'3' == 3` is true in PHP. Not here, in either spelling.
    expect(Expr::evaluate("'3' === 3"))->toBeFalse();
    expect(Expr::evaluate("'3' == 3"))->toBeFalse();

    // 3. Short-circuit returns the OPERAND, not a boolean.
    expect(Expr::evaluate('a || b', ['a' => null, 'b' => 'fallback']))->toBe('fallback');
    expect(Expr::evaluate('a && b', ['a' => 0, 'b' => 'unused']))->toBe(0);
});

it('keeps absence and malformity apart', function (): void {
    // The reason the package exists, as one assertion.
    expect(Expr::evaluate('in.nothing', ['in' => []]))->toBeNull();
    expect(fn () => Expr::evaluate('in.a &&', ['in' => []]))->toThrow(ExprSyntaxError::class);
});

it('holds the sandbox', function (): void {
    // These expressions arrive from end users and from agents, over the wire.
    expect(Expr::evaluate('x.length', ['x' => [1, 2]]))->toBe(2);
    expect(Expr::evaluate('s.length', ['s' => 'abc']))->toBe(3);
    expect(fn () => Expr::evaluate('phpinfo()'))->toThrow(ExprSyntaxError::class);
    expect(fn () => Expr::evaluate('x.map(y)', ['x' => []]))->toThrow(ExprSyntaxError::class);
});
