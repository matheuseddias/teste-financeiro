import { describe, expect, it } from 'vitest';
import { access, canDelete, parseBrl, validateAccount, type Membership } from './index';
describe('Dinheiro, permissões e cadastros', () => {
  it('converte valores brasileiros sem perder centavos nem aceitar separadores ambíguos', () => {
    expect(parseBrl('1.234,56')).toBe(123456);
    expect(parseBrl('-0,01')).toBe(-1);
    expect(parseBrl('')).toBeNull();
    for (const bad of ['1,234.56', '1e10', 'NaN', '12.34', '1,234', '90000000001'])
      expect(() => parseBrl(bad)).toThrow();
  });
  it('ausência de permissão não libera a área; administrador inativo não acessa', () => {
    const m = { role: 'membro', active: true, permissions: { contas: 'view' } } as Membership;
    expect(access(m, 'contas')).toBe('view');
    expect(access(m, 'empresas')).toBe('none');
    expect(access({ ...m, role: 'admin', active: false }, 'contas')).toBe('none');
  });
  it('30% é limite estrito, inclusive em tabelas pequenas', () => {
    expect(canDelete(3, 10)).toBe(true);
    expect(canDelete(4, 10)).toBe(false);
    expect(canDelete(1, 2)).toBe(false);
    expect(canDelete(0, 0)).toBe(false);
  });
  it('saldo nunca existe sem data e zero é um saldo válido', () => {
    const account = { company_id: 'empresa', name: 'Principal', bank_name: 'Kamino',
      account_number: '123-4', kind: 'pagamento' as const, currency: 'BRL' as const };
    expect(validateAccount({ ...account, reference_balance_cents: 0 })).not.toBeNull();
    expect(validateAccount({ ...account, reference_balance_cents: 0, reference_date: '2026-10-01' })).toBeNull();
    expect(validateAccount({ ...account, reference_balance_cents: 0, reference_date: '2026-02-30' })).not.toBeNull();
  });
});
