/**
 * The tokenizer. Turns source text into a flat token list, or throws.
 *
 * Kept separate from the parser so a malformed *character* (an unterminated
 * string, a stray `@`) fails here with an offset, rather than surfacing as a
 * confusing parse error about something three tokens later.
 */

export type TokenType =
  | "number"
  | "string"
  | "ident"
  | "punct"
  | "eof";

export type Token = {
  type: TokenType;
  /** For `number` the numeric value; for everything else the source text. */
  value: string | number;
  /** Byte offset of the token's first character, for error messages. */
  at: number;
};

/**
 * The stable reason an expression was refused. The MESSAGE is for people and
 * may change; the code may not. Pinned by `expr/limits` in fancy-conformance.
 */
export type ExprErrorCode = "EXPR_SYNTAX" | "EXPR_TOO_LONG" | "EXPR_TOO_DEEP";

/** Longest expression quoted back in a message; longer ones are elided. */
const QUOTE_LIMIT = 120;

/** Thrown for anything that cannot be tokenized or parsed. NEVER returned. */
export class ExprSyntaxError extends Error {
  constructor(
    message: string,
    readonly expression: string,
    readonly at: number,
    readonly code: ExprErrorCode = "EXPR_SYNTAX",
  ) {
    // Quoted back for the author, but never in full past QUOTE_LIMIT: an
    // expression refused for being 8 KiB should not produce an 8 KiB message.
    let quoted = expression;
    if (expression.length > QUOTE_LIMIT) {
      // Never split a surrogate pair, so the message stays well-formed.
      const high = expression.charCodeAt(QUOTE_LIMIT - 1);
      const cut = high >= 0xd800 && high <= 0xdbff ? QUOTE_LIMIT - 1 : QUOTE_LIMIT;
      quoted = `${expression.slice(0, cut)}...`;
    }
    super(`${message} (at offset ${at} in \`${quoted}\`)`);
    this.name = "ExprSyntaxError";
  }
}

/**
 * Multi-character operators, longest first.
 *
 * Order matters and is the classic tokenizer trap: match `=` before `===` and
 * every strict comparison silently becomes two tokens. Sorted by length at
 * module load so adding one cannot reintroduce that.
 */
const PUNCT = [
  "===", "!==", "==", "!=", "<=", ">=", "&&", "||",
  "?", ":", ".", ",", "(", ")", "[", "]", "{", "}", "+", "-", "*", "/", "<", ">", "!",
].sort((a, b) => b.length - a.length);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_REST = /[A-Za-z0-9_$-]/;

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    // Strings. Both quote styles, because authors use both, with backslash
    // escapes for the quote itself and the backslash.
    if (ch === "'" || ch === '"') {
      const start = i;
      const quote = ch;
      let out = "";
      i += 1;
      let closed = false;

      while (i < source.length) {
        if (source[i] === "\\" && i + 1 < source.length) {
          out += source[i + 1];
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          closed = true;
          break;
        }
        out += source[i];
        i += 1;
      }

      if (!closed) throw new ExprSyntaxError("Unterminated string", source, start);
      tokens.push({ type: "string", value: out, at: start });
      continue;
    }

    // Numbers. Digits only at the start — a leading `-` is unary minus and is
    // the parser's business, so `1-2` tokenizes as three tokens rather than two.
    if (ch >= "0" && ch <= "9") {
      const start = i;
      while (i < source.length && source[i] >= "0" && source[i] <= "9") i += 1;
      if (source[i] === "." && source[i + 1] >= "0" && source[i + 1] <= "9") {
        i += 1;
        while (i < source.length && source[i] >= "0" && source[i] <= "9") i += 1;
      }
      tokens.push({ type: "number", value: Number(source.slice(start, i)), at: start });
      continue;
    }

    if (IDENT_START.test(ch)) {
      const start = i;
      i += 1;
      while (i < source.length && IDENT_REST.test(source[i])) i += 1;
      tokens.push({ type: "ident", value: source.slice(start, i), at: start });
      continue;
    }

    const punct = PUNCT.find((p) => source.startsWith(p, i));
    if (punct) {
      tokens.push({ type: "punct", value: punct, at: i });
      i += punct.length;
      continue;
    }

    throw new ExprSyntaxError(`Unexpected character \`${ch}\``, source, i);
  }

  tokens.push({ type: "eof", value: "", at: source.length });
  return tokens;
}
