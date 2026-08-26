<?php

declare(strict_types=1);

namespace FancyExpr;

use RuntimeException;

/**
 * Thrown for anything that cannot be tokenized or parsed. NEVER returned.
 *
 * The distinction this class exists to enforce: an unresolved PATH is `null`,
 * because a field absent today may be present tomorrow. A MALFORMED expression
 * throws, because it can never resolve on any input. Those two being the same
 * value is the defect this package replaces -- a branch condition the engine
 * could not evaluate read as `false` and routed a live graph the wrong way on
 * every run, reporting success.
 */
final class ExprSyntaxError extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $expression,
        public readonly int $at,
    ) {
        parent::__construct(sprintf('%s (at offset %d in `%s`)', $message, $at, $expression));
    }
}
