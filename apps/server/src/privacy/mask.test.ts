import { describe, expect, it } from 'vitest';
import { createMasker, luhnValid, maskText } from './mask.js';

// All values below are fictitious (generated/from documentation), never real data.
describe('maskText', () => {
  it('masks formatted and bare CPF', () => {
    const r = maskText('cliente 123.456.789-09 e outro 12345678909');
    expect(r.text).toBe('cliente [CPF] e outro [CPF]');
    expect(r.counts.CPF).toBe(2);
  });

  it('masks formatted and bare CNPJ', () => {
    expect(maskText('empresa 12.345.678/0001-95').text).toBe('empresa [CNPJ]');
    expect(maskText('cnpj 12345678000195').text).toBe('cnpj [CNPJ]');
  });

  it('masks e-mail and phone', () => {
    const r = maskText('fale com fulano.teste@exemplo.com ou (11) 98765-4321 / +55 11 91234 5678');
    expect(r.text).toBe('fale com [EMAIL] ou [TELEFONE] / [TELEFONE]');
  });

  it('masks a card only when it passes Luhn', () => {
    expect(maskText('cartão 4111 1111 1111 1111').text).toBe('cartão [CARTAO]');
    expect(luhnValid('4111111111111112')).toBe(false);
  });

  it('keeps the label and masks bank data and income', () => {
    const r = maskText('Agência: 1234-5 Conta corrente 12345678-9 renda mensal de R$ 5.432,10 salário 3000');
    expect(r.text).toBe('Agência: [AGENCIA] Conta corrente [CONTA] renda mensal de [VALOR] salário [VALOR]');
  });

  it('masks BRL amounts, CEP and RG', () => {
    expect(maskText('parcela R$ 1.250,00').text).toBe('parcela [VALOR]');
    expect(maskText('CEP 01310-100').text).toBe('CEP [CEP]');
    expect(maskText('RG: 12.345.678-X').text).toBe('RG: [RG]');
  });

  it('masks secrets', () => {
    const r = maskText('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789 e mongodb+srv://user:p4ss@cluster0.mongodb.net/db');
    expect(r.text).not.toContain('ghp_abcdef');
    expect(r.text).not.toContain('p4ss');
    expect(r.counts.SEGREDO).toBeGreaterThanOrEqual(2);
  });

  it('keeps Discord mentions, issues, PRs and URLs', () => {
    const input = '<@123456789012345678> veja https://github.com/org/repo/pull/9649 e #7959 hoje 09:30 (2026-11-16)';
    const r = maskText(input);
    expect(r.text).toBe(input);
    expect(r.total).toBe(0);
  });

  it('masks PII in the URL query string, keeping the path', () => {
    const r = maskText('https://exemplo.com/consulta?cpf=123.456.789-09&x=1');
    expect(r.text).toBe('https://exemplo.com/consulta?cpf=[CPF]&x=1');
  });

  it('accepts extra patterns from .env and ignores an invalid regex', () => {
    const mask = createMasker(['PROPOSTA-\\d+', '([']);
    expect(mask('ver PROPOSTA-998877').text).toBe('ver [EXTRA]');
  });

  it('handles empty input', () => {
    expect(maskText(undefined)).toEqual({ text: '', counts: {}, total: 0 });
  });
});
