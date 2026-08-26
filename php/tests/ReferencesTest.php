<?php

declare(strict_types=1);

use FancyExpr\Expr;
use FancyExpr\ExprSyntaxError;
use ParticleAcademy\Conformance\Conformance;

/*
 * `expr/references` — the STATIC question, run against the PHP implementation.
 *
 * Same discipline as the evaluate table: the rows were published before this
 * function existed here, and it was written against them.
 */

/**
 * @param  array<string,mixed>  $case
 * @return array<string,mixed>
 */
function runReferenceCase(array $case): array
{
    try {
        return ['ok' => true, 'value' => Expr::references($case['input']['expression'])];
    } catch (ExprSyntaxError) {
        return ['ok' => false];
    }
}

it('matches the expr/references table on every case', function (): void {
    $summary = Conformance::runTable('expr/references', runReferenceCase(...));

    echo "\n".Conformance::formatSummary($summary)."\n";

    $failures = array_filter(
        $summary['results'] ?? [],
        static fn (array $r): bool => ($r['status'] ?? '') === 'fail',
    );

    expect($failures)->toBe([], 'PHP disagrees on: '.implode(', ', array_column($failures, 'id')));
    expect($summary['failed'])->toBe(0);

    // The vacuity floor. A suite that loaded nothing reports zero failures too.
    expect($summary['passed'])->toBeGreaterThan(8);
});

it('is enough for a host to reject the reported $now', function (): void {
    // The consumer's case, written the way a host actually would. `$now` looks
    // exactly as valid as `$json` to an author, and shipped a document titled
    // "Deal List Export -" with the date silently missing.
    $provided = ['in', '$json', '$input', '$props'];
    $unknown = fn (string $e): array => array_values(array_diff(Expr::references($e), $provided));

    expect($unknown("'Deal List Export - ' + \$now"))->toBe(['$now']);
    expect($unknown("'Deal List Export - ' + \$json.date"))->toBe([]);

    // A PHP author's reflex is `.` for concatenation. It is NOT an operator in
    // this grammar, and it is refused rather than silently truncating the
    // expression to its first string -- which is how a typo becomes a wrong
    // answer instead of a message.
    expect(fn () => Expr::references("'Deal List Export - '.\$now"))
        ->toThrow(ExprSyntaxError::class);

    // The second reported shape: a REAL node id, two hops upstream. Legal
    // looking, resolves to nothing. One primitive, both shapes.
    $predecessors = ['in', 'n5'];
    expect(array_values(array_diff(Expr::references('n2.transcript'), $predecessors)))->toBe(['n2']);
});

it('cannot catch a real root with a field that node never emits', function (): void {
    // The boundary, asserted rather than left to be discovered.
    expect(Expr::references('in.output'))->toBe(['in']);
});

it('resists what a plausible implementation would get wrong', function (): void {
    // Object KEYS are written, not read. Reporting them would make a host
    // reject a VALID expression, and the author would have no way to comply.
    expect(Expr::references("{ transcript: in.content, source: 'manual' }"))->toBe(['in']);

    // Every branch, not only the one a run would take. Reusing the evaluator's
    // short-circuit is the obvious implementation and the wrong one.
    expect(Expr::references('a ? b : c'))->toBe(['a', 'b', 'c']);
    expect(Expr::references('a || b'))->toBe(['a', 'b']);

    // A computed index counts; a named step and a literal index do not.
    expect(Expr::references('items[i]'))->toBe(['i', 'items']);
    expect(Expr::references('items[0]'))->toBe(['items']);
    expect(Expr::references('items.length'))->toBe(['items']);

    // Malformed RAISES rather than returning []. An empty list would tell a
    // host "this expression needs nothing" and let it save an unrunnable node.
    expect(fn () => Expr::references('in.a &&'))->toThrow(ExprSyntaxError::class);
    expect(fn () => Expr::references(''))->toThrow(ExprSyntaxError::class);
});
