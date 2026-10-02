import { useState } from 'react';
import { Plus, Pencil, Landmark } from 'lucide-react';
import { access, money, parseBrl, validateAccount, type BankAccount } from '@eddias/core';
import { useAuth } from '../app/auth';
import { useStore } from '../domain/store';
import { message } from '../data/client';
import { Empty, Notice, useDraft } from '../ui';
import { Archive } from './Companies';
export function Accounts() {
  const { member } = useAuth(); const { data } = useStore();
  const [editing, setEditing] = useState<BankAccount | 'new' | null>(null);
  const canEdit = access(member, 'contas') === 'edit';
  return <><div className="page-heading"><div><p className="eyebrow">CADASTROS</p><h1>Contas bancárias</h1><p>Organize as contas de cada empresa em um só lugar.</p></div>
    {canEdit && <button onClick={() => setEditing('new')}><Plus size={18} />Cadastrar conta</button>}</div>
    {editing && <AccountForm key={editing === 'new' ? 'new' : editing.id} account={editing === 'new' ? null : editing} close={() => setEditing(null)} />}
    {!data?.accounts.length ? <Empty title="Nenhuma conta cadastrada">Cadastre a empresa e adicione suas contas bancárias ou digitais.</Empty> :
      <div className="account-grid">{data.accounts.map(account => <article className="card account-card" key={account.id}>
        <div className="row"><span className="account-icon"><Landmark size={22} /></span><span className="badge">{account.kind === 'pagamento' ? 'Conta de pagamento' : account.kind === 'poupanca' ? 'Poupança' : 'Conta corrente'}</span></div>
        <h2>{account.name}</h2><p>{account.bank_name} · {data.companies.find(c => c.id === account.company_id)?.name || 'Empresa'}</p>
        <dl><div><dt>Agência</dt><dd>{account.branch || 'Não se aplica'}</dd></div><div><dt>Conta</dt><dd>{account.account_number}</dd></div></dl>
        <div className="reference"><span>Saldo de referência{account.reference_date ? ' · ' + account.reference_date.split('-').reverse().join('/') : ''}</span><strong>{money(account.reference_balance_cents)}</strong>
          {account.reference_date && <small>Valor informado, ainda não conciliado.</small>}</div>
        <div className="actions">{canEdit && <button className="secondary" onClick={() => setEditing(account)}><Pencil size={15} />Editar</button>}
          {member.role === 'admin' && <Archive entity="bank_accounts" id={account.id} name={account.name} />}</div>
      </article>)}</div>}
  </>;
}
function AccountForm({ account, close }: { account: BankAccount | null; close: () => void }) {
  const { member, session } = useAuth(); const { data, repo, mutate, busy } = useStore();
  const initial = { version: account?.version || 0, id: account?.id || crypto.randomUUID(), company_id: account?.company_id || '',
    name: account?.name || '', bank_name: account?.bank_name || '', bank_code: account?.bank_code || '',
    branch: account?.branch || '', account_number: account?.account_number || '', kind: account?.kind || 'corrente',
    reference_date: account?.reference_date || '',
    balance: account?.reference_balance_cents == null ? '' : (account.reference_balance_cents / 100).toFixed(2).replace('.', ',') };
  const draft = useDraft('fin:account:' + session.user.id + ':' + member.tenant_id + ':' + (account?.id || 'new'), initial);
  const [error, setError] = useState('');
  const v = draft.value;
  function field(key: keyof typeof v, value: string) { draft.update({ ...v, [key]: value }); }
  return <section className="card editor"><h2>{account ? 'Editar conta' : 'Cadastrar conta bancária'}</h2>
    <form data-dirty={draft.dirty} onSubmit={async e => {
      e.preventDefault(); setError('');
      try {
        const payload = { company_id: v.company_id, name: v.name.trim(), bank_name: v.bank_name.trim(),
          bank_code: v.bank_code.trim(), branch: v.branch.trim(), account_number: v.account_number.trim(),
          kind: v.kind, currency: 'BRL' as const, reference_date: v.reference_date || null,
          reference_balance_cents: parseBrl(v.balance) };
        const invalid = validateAccount(payload); if (invalid) throw new Error(invalid);
        await mutate(() => repo.saveAccount(v.id, payload, v.version)); draft.clear(); close();
      } catch (e) { setError(message(e)); }
    }}>
      <div className="form-grid"><label>Empresa<select aria-label="Empresa" required value={v.company_id} onChange={e => field('company_id', e.target.value)}><option value="">Selecione</option>{data?.companies.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
        <label>Nome da conta<input required maxLength={120} value={v.name} placeholder="Ex.: Kamino principal" onChange={e => field('name', e.target.value)} /></label>
        <label>Banco ou instituição<input required maxLength={120} value={v.bank_name} onChange={e => field('bank_name', e.target.value)} /></label>
        <label>Código do banco (opcional)<input maxLength={8} value={v.bank_code} onChange={e => field('bank_code', e.target.value)} /></label>
        <label>Agência (opcional)<input maxLength={30} value={v.branch} onChange={e => field('branch', e.target.value)} /></label>
        <label>Número da conta<input required maxLength={60} value={v.account_number} onChange={e => field('account_number', e.target.value)} /></label>
        <label>Tipo de conta<select value={v.kind} onChange={e => field('kind', e.target.value)}><option value="corrente">Conta corrente</option><option value="pagamento">Conta de pagamento / digital</option><option value="poupanca">Poupança</option></select></label>
        <label>Data do saldo de referência<input type="date" value={v.reference_date} onChange={e => field('reference_date', e.target.value)} /></label>
        <label>Saldo de referência (R$)<input inputMode="decimal" value={v.balance} placeholder="Opcional · 0,00" onChange={e => field('balance', e.target.value)} /></label></div>
      <p className="muted">O saldo e sua data devem ser informados juntos. Não representam uma conciliação bancária.</p>
      {error && <Notice error>{error}</Notice>}{draft.storageError && <Notice error>Não foi possível guardar o rascunho neste dispositivo.</Notice>}
      <div className="actions">{draft.dirty && <button type="button" className="secondary" onClick={() => { if (window.confirm('Descartar este rascunho e recuperar os valores carregados?')) draft.clear(); }}>Descartar rascunho</button>}<button disabled={busy}>{busy ? 'Salvando…' : 'Salvar conta'}</button><button type="button" className="secondary" onClick={() => { if (!draft.dirty || window.confirm('Fechar e manter o rascunho para continuar depois?')) close(); }}>Fechar</button>
        {draft.dirty && <span className="muted">Rascunho neste dispositivo</span>}</div>
    </form></section>;
}
