import { describe, expect, it } from 'vitest';
import { redactText } from '../src/index.js';

describe('redactText', () => {
  it('leaves a text without personal data untouched', () => {
    const text = 'El pedido 12345 llegó el 3 de mayo a las 10:30.';
    expect(redactText(text)).toEqual({ text, redactions: 0 });
  });

  it('masks emails', () => {
    const result = redactText('Escribe a ana.perez+x@correo.co o a juan@example.com');
    expect(result.text).toBe('Escribe a [EMAIL_1] o a [EMAIL_2]');
    expect(result.redactions).toBe(2);
  });

  it('reuses the marker of a repeated value', () => {
    expect(redactText('a@b.co y a@b.co').text).toBe('[EMAIL_1] y [EMAIL_1]');
  });

  it.each([
    ['Llámame al 3001234567', 'Llámame al [PHONE_1]'],
    ['Llámame al 300 123 4567', 'Llámame al [PHONE_1]'],
    ['Llámame al +57 300 123 4567', 'Llámame al [PHONE_1]'],
    ['Llámame al (601) 234 5678', 'Llámame al [PHONE_1]'],
    ['Call +1 415 555 2671 now', 'Call [PHONE_1] now'],
    ['Call +44 20 7946 0958 now', 'Call [PHONE_1] now'],
  ])('masks the phone in «%s»', (input, expected) => {
    expect(redactText(input).text).toBe(expected);
  });

  it('masks a card that passes the Luhn check', () => {
    expect(redactText('Tarjeta 4111 1111 1111 1111 vence pronto').text).toBe(
      'Tarjeta [CARD_1] vence pronto',
    );
    expect(redactText('Tarjeta 4111-1111-1111-1111').text).toBe('Tarjeta [CARD_1]');
    expect(redactText('Tarjeta 4111111111111111').text).toBe('Tarjeta [CARD_1]');
  });

  it('does not mask a long number that fails the Luhn check as a card', () => {
    const result = redactText('Referencia 4111 1111 1111 1112');
    expect(result.text).not.toContain('[CARD_');
  });

  it.each([
    ['Cédula 1.020.304.050', 'Cédula [ID_1]'],
    ['cedula de ciudadania 1020304050', 'cedula de ciudadania [ID_1]'],
    ['CC 79456123', 'CC [ID_1]'],
    ['C.C. 79.456.123', 'C.C. [ID_1]'],
    ['NIT 900.123.456-7', 'NIT [ID_1]'],
    ['nit: 900123456-7', 'nit: [ID_1]'],
  ])('masks the id in «%s»', (input, expected) => {
    expect(redactText(input).text).toBe(expected);
  });

  it('does not mask a plain number without a keyword', () => {
    expect(redactText('Total 79456123 pesos').text).toBe('Total 79456123 pesos');
  });

  it('numbers each category on its own', () => {
    const result = redactText('a@b.co, c@d.co, cédula 79456123 y 3001234567');
    expect(result.text).toBe('[EMAIL_1], [EMAIL_2], cédula [ID_1] y [PHONE_1]');
    expect(result.redactions).toBe(4);
  });

  it('is irreversible: the output carries nothing of the original values', () => {
    const result = redactText('ana@correo.co 3001234567 CC 79456123');
    expect(result.text).not.toMatch(/ana|3001234567|79456123/);
  });
});
