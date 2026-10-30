export type TemplateToken =
  { kind: 'text'; value: string } | { kind: 'ref'; path: string; start: number; end: number };

export type TemplateErrorCode =
  'TEMPLATE_UNCLOSED' | 'TEMPLATE_STRAY_CLOSE' | 'TEMPLATE_EMPTY' | 'TEMPLATE_NESTED';

export interface TemplateError {
  code: TemplateErrorCode;
  message: string;
  /** Offset of the offending marker in the original text. */
  start: number;
}

export interface TemplateParts {
  tokens: TemplateToken[];
  errors: TemplateError[];
}

const OPEN = '{{';
const CLOSE = '}}';

/**
 * Splits text into literal pieces and `{{reference}}` markers.
 *
 * Hand-written scanner, single pass. The content of a marker is only trimmed and handed back as a
 * reference path for the validator: it is never interpreted, compiled or executed.
 */
export function tokenizeTemplate(text: string): TemplateParts {
  const tokens: TemplateToken[] = [];
  const errors: TemplateError[] = [];
  let cursor = 0;
  let literalStart = 0;

  const flushLiteral = (end: number) => {
    if (end > literalStart) tokens.push({ kind: 'text', value: text.slice(literalStart, end) });
  };

  while (cursor < text.length) {
    const open = text.indexOf(OPEN, cursor);
    const stray = text.indexOf(CLOSE, cursor);

    if (stray !== -1 && (open === -1 || stray < open)) {
      errors.push({
        code: 'TEMPLATE_STRAY_CLOSE',
        message: `Hay un «}}» sin su «{{» en la posición ${stray}.`,
        start: stray,
      });
      cursor = stray + CLOSE.length;
      continue;
    }
    if (open === -1) break;

    const close = text.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      errors.push({
        code: 'TEMPLATE_UNCLOSED',
        message: `El marcador que empieza en la posición ${open} no se cierra con «}}».`,
        start: open,
      });
      break;
    }

    const inner = text.slice(open + OPEN.length, close);
    if (inner.includes(OPEN)) {
      errors.push({
        code: 'TEMPLATE_NESTED',
        message: `Los marcadores no se pueden anidar (posición ${open}).`,
        start: open,
      });
    } else if (inner.trim() === '') {
      errors.push({
        code: 'TEMPLATE_EMPTY',
        message: `El marcador de la posición ${open} está vacío.`,
        start: open,
      });
    } else {
      flushLiteral(open);
      tokens.push({ kind: 'ref', path: inner.trim(), start: open, end: close + CLOSE.length });
      literalStart = close + CLOSE.length;
    }
    cursor = close + CLOSE.length;
  }

  flushLiteral(text.length);
  return { tokens, errors };
}
