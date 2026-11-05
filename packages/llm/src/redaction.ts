/**
 * Masks personal data before a text leaves for the provider (research R9, `redactPii`). The
 * detectors favour not leaking over not masking too much, except for numbers that look like an id:
 * those need a keyword next to them. Masking is irreversible: markers are numbered by distinct
 * value, and the values are not kept anywhere.
 */

export interface RedactionResult {
  text: string;
  /** Occurrences replaced by a marker. */
  redactions: number;
}

type Category = 'EMAIL' | 'CARD' | 'ID' | 'PHONE';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

/** 13 to 19 digits, optionally grouped by spaces or hyphens; confirmed with the Luhn check. */
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

/**
 * Colombian id: cédula or NIT after its keyword. The number may be grouped with dots or spaces
 * and a NIT may carry its check digit after a hyphen. The keyword stays in the text.
 */
const ID_WITH_KEYWORD =
  /((?<![A-Za-zÁÉÍÓÚáéíóúñ])(?:c[ée]dula(?:\s+de\s+ciudadan[íi]a)?|c\.?\s?c\.?|nit|documento(?:\s+de\s+identidad)?)(?![A-Za-zÁÉÍÓÚáéíóúñ])[\s:#.]*)(\d{1,3}(?:[.\s]\d{3}){1,3}|\d{6,12})(?:-\d)?/gi;

/** International: `+` country code and 8 to 15 digits in total. */
const PHONE_INTERNATIONAL = /(?<![\w+])\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?!\d)/g;
/** Colombian mobile: ten digits starting with 3. */
const PHONE_CO_MOBILE = /(?<!\d)3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
/** Colombian landline with area code `60X`. */
const PHONE_CO_LANDLINE = /(?<![\d(])\(?60\d\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

class Markers {
  private readonly seen = new Map<Category, Map<string, number>>();
  redactions = 0;

  marker(category: Category, value: string): string {
    const byValue = this.seen.get(category) ?? new Map<string, number>();
    this.seen.set(category, byValue);
    let index = byValue.get(value);
    if (index === undefined) {
      index = byValue.size + 1;
      byValue.set(value, index);
    }
    this.redactions++;
    return `[${category}_${index}]`;
  }
}

export function redactText(text: string): RedactionResult {
  const markers = new Markers();
  let result = text.replace(EMAIL, (match) => markers.marker('EMAIL', match.toLowerCase()));

  result = result.replace(CARD_CANDIDATE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return match;
    return markers.marker('CARD', digits);
  });

  result = result.replace(ID_WITH_KEYWORD, (_match, prefix: string, number: string) => {
    return `${prefix}${markers.marker('ID', number.replace(/\D/g, ''))}`;
  });

  result = result.replace(PHONE_INTERNATIONAL, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return match;
    return markers.marker('PHONE', digits);
  });
  for (const pattern of [PHONE_CO_MOBILE, PHONE_CO_LANDLINE]) {
    result = result.replace(pattern, (match) => markers.marker('PHONE', match.replace(/\D/g, '')));
  }

  return { text: result, redactions: markers.redactions };
}
