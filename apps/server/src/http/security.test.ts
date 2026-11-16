import { describe, expect, it } from 'vitest';
import { makeGuard } from './security.js';

const allowed = makeGuard([9999, 5173]);

describe('guard de localhost', () => {
  it('aceita GET de host local', () => {
    expect(allowed({ method: 'GET', host: '127.0.0.1:9999', origin: undefined, marker: undefined })).toBe(true);
    expect(allowed({ method: 'GET', host: 'localhost:5173', origin: undefined, marker: undefined })).toBe(true);
  });

  it('recusa host externo (DNS rebinding)', () => {
    expect(allowed({ method: 'GET', host: 'evil.example:9999', origin: undefined, marker: undefined })).toBe(false);
    expect(allowed({ method: 'GET', host: '127.0.0.1:1234', origin: undefined, marker: undefined })).toBe(false);
  });

  it('exige o cabeçalho marcador em escritas', () => {
    expect(allowed({ method: 'POST', host: '127.0.0.1:9999', origin: undefined, marker: undefined })).toBe(false);
    expect(allowed({ method: 'POST', host: '127.0.0.1:9999', origin: undefined, marker: '1' })).toBe(true);
  });

  it('recusa escrita com Origin externa', () => {
    expect(allowed({ method: 'POST', host: '127.0.0.1:9999', origin: 'https://evil.example', marker: '1' })).toBe(false);
    expect(allowed({ method: 'POST', host: '127.0.0.1:9999', origin: 'http://localhost:5173', marker: '1' })).toBe(true);
  });
});
