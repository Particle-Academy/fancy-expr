<?php

declare(strict_types=1);

use FancyExpr\Expr;
use FancyExpr\ExprSyntaxError;

/*
 * The input bounds, from GRAMMAR.md "Limits".
 *
 * The authoritative rows are `expr/limits` in fancy-conformance (since 0.35.0),
 * and this repository pins 0.35.0: ConformanceTest.php runs all 27 of them from
 * the pinned package. This file keeps the probes the table cannot express --
 * the exported constants, the message not quoting an oversized expression, and
 * references() hitting the same bounds -- plus a direct copy of the boundary
 * checks, so a limit regression names itself here as well as by case id. Every
 * limit is asserted from BOTH sides: refusing everything long or nested would
 * pass the out-of-limit half alone.
 */

function limitCode(string $expression, array $context = []): string
{
    try {
        Expr::evaluate($expression, $context);
    } catch (ExprSyntaxError $e) {
        return $e->errorCode;
    }

    return 'OK';
}

it('documents 8192 bytes and 64 levels', function (): void {
    expect(Expr::MAX_EXPRESSION_BYTES)->toBe(8192);
    expect(Expr::MAX_EXPRESSION_DEPTH)->toBe(64);
});

it('accepts exactly 8192 bytes and refuses 8193', function (): void {
    expect(Expr::evaluate('1'.str_repeat(' ', 8191)))->toBe(1);
    expect(limitCode('1'.str_repeat(' ', 8192)))->toBe('EXPR_TOO_LONG');
});

it('counts UTF-8 bytes', function (): void {
    expect(limitCode("'".str_repeat("\u{e9}", 4096)."'"))->toBe('EXPR_TOO_LONG');
    expect(Expr::evaluate("'".str_repeat("\u{e9}", 4095)."'"))->toBe(str_repeat("\u{e9}", 4095));
});

it('checks length before tokenizing', function (): void {
    expect(limitCode(str_repeat('@', 8193)))->toBe('EXPR_TOO_LONG');
});

it('does not put an oversized expression in the message', function (): void {
    try {
        Expr::parse('1'.str_repeat(' ', 9000));
    } catch (ExprSyntaxError $e) {
        expect(strlen($e->getMessage()))->toBeLessThan(200);

        return;
    }
    throw new RuntimeException('expected a throw');
});

dataset('depth shapes', [
    'parentheses' => [fn (int $n): string => str_repeat('(', $n).'1'.str_repeat(')', $n), 63],
    'unary' => [fn (int $n): string => str_repeat('!', $n).'true', 63],
    'binary chain' => [fn (int $n): string => implode('+', array_fill(0, $n + 1, '1')), 63],
    'arrays' => [fn (int $n): string => str_repeat('[', $n).str_repeat(']', $n), 64],
    'objects' => [fn (int $n): string => str_repeat('{a:', $n).'1'.str_repeat('}', $n), 63],
    'indices' => [fn (int $n): string => str_repeat('x[', $n).'0'.str_repeat(']', $n), 63],
    'ternaries' => [fn (int $n): string => str_repeat('false ? 0 : ', $n).'1', 63],
]);

it('evaluates at the depth limit and refuses one past it', function (Closure $build, int $atLimit): void {
    expect(limitCode($build($atLimit), ['x' => [0]]))->toBe('OK');
    expect(limitCode($build($atLimit + 1), ['x' => [0]]))->toBe('EXPR_TOO_DEEP');
})->with('depth shapes');

it('refuses the stack-overflow shapes with its own error', function (): void {
    expect(limitCode(str_repeat('(', 4000).'1'.str_repeat(')', 4000)))->toBe('EXPR_TOO_DEEP');
    expect(limitCode(str_repeat('(', 8000)))->toBe('EXPR_TOO_DEEP');
    expect(limitCode(implode('+', array_fill(0, 4000, '1'))))->toBe('EXPR_TOO_DEEP');
});

it('does not count dot-segments or width', function (): void {
    expect(Expr::evaluate('a'.str_repeat('.b', 500)))->toBeNull();
    expect(Expr::evaluate('['.implode(',', array_fill(0, 1000, '1')).']'))->toHaveCount(1000);
});

it('applies to references() too', function (): void {
    expect(fn () => Expr::references(str_repeat('(', 8000)))->toThrow(ExprSyntaxError::class);
});

it('gives every other parse failure EXPR_SYNTAX', function (): void {
    expect(limitCode('in.a &&'))->toBe('EXPR_SYNTAX');
    expect(limitCode("'unterminated"))->toBe('EXPR_SYNTAX');
    expect(limitCode('f()'))->toBe('EXPR_SYNTAX');
});
