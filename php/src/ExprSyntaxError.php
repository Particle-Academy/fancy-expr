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
    /** Longest expression quoted back in a message; longer ones are elided. */
    private const QUOTE_LIMIT = 120;

    /**
     * `$errorCode` is the stable reason -- EXPR_SYNTAX, EXPR_TOO_LONG or
     * EXPR_TOO_DEEP, pinned by `expr/limits` in fancy-conformance. The message
     * is for people and may change; the code may not. It is not `$code`
     * because Exception already owns an untyped integer `$code`.
     */
    public function __construct(
        string $message,
        public readonly string $expression,
        public readonly int $at,
        public readonly string $errorCode = 'EXPR_SYNTAX',
    ) {
        // Quoted back for the author, never in full: an expression refused for
        // being 8 KiB should not produce an 8 KiB message.
        $quoted = $expression;
        if (strlen($expression) > self::QUOTE_LIMIT) {
            // Back off to a character boundary so the message stays valid UTF-8.
            $cut = self::QUOTE_LIMIT;
            while ($cut > 0 && (ord($expression[$cut]) & 0xC0) === 0x80) {
                $cut--;
            }
            $quoted = substr($expression, 0, $cut).'...';
        }

        parent::__construct(sprintf('%s (at offset %d in `%s`)', $message, $at, $quoted));
    }
}
