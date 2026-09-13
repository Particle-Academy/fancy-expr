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

/*
 * The fixture set every leg of this repository runs against. Rule 4 of
 * fancy-conformance's runners/README.md: print AND assert it.
 *
 * composer.lock is NOT committed (this is a library), so the require-dev
 * constraint is the only thing CI resolves from. It was `>=0.16.0 <2.0`, which
 * meant "the newest release on the day the job runs" -- 0.22.0 on 2026-09-13,
 * while the Node leg was locked at 0.18.0 and nothing on either side said so.
 * The constraint is now EXACT: it admits one version with or without a lock,
 * and require-dev never reaches a consumer, so the exactness costs nobody.
 * The assertion below is what makes it a checked claim rather than a setting.
 *
 * Pinned at 0.22.0 after re-running both tables here: expr/evaluate 48 (+1
 * documented skip, 0904), expr/references 12 -- the same as at 0.18.0, whose
 * two tables are byte-identical to 0.22.0's. Move it only with the Node and
 * Python pins; the tests on every side fail until all of them agree.
 */
const PINNED_SUITE_VERSION = '0.22.0';

it('runs against the pinned fixture set, and says which', function (): void {
    echo "\nfancy-conformance installed: ".Conformance::version().', pinned: '.PINNED_SUITE_VERSION."\n";

    expect(Conformance::version())->toBe(PINNED_SUITE_VERSION);
});

it('pins the same fixture set as the Node and Python legs', function (): void {
    $root = dirname(__DIR__, 2);

    $composer = json_decode((string) file_get_contents($root.'/composer.json'), true, flags: JSON_THROW_ON_ERROR);
    expect($composer['require-dev']['particle-academy/fancy-conformance'] ?? null)->toBe(PINNED_SUITE_VERSION);

    // Node pins through its COMMITTED lockfile, so its range keeps the caret.
    $package = json_decode((string) file_get_contents($root.'/package.json'), true, flags: JSON_THROW_ON_ERROR);
    expect($package['devDependencies']['@particle-academy/fancy-conformance'] ?? null)->toBe('^'.PINNED_SUITE_VERSION);

    // Python checks the fixtures out from git; its pin is a constant tied to the
    // CI checkout ref by a test of its own.
    $python = (string) file_get_contents($root.'/python/tests/test_conformance.py');
    expect(preg_match('/^PINNED_SUITE_VERSION = "([^"]+)"\r?$/m', $python, $match))->toBe(1);
    expect($match[1])->toBe(PINNED_SUITE_VERSION);
});

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
