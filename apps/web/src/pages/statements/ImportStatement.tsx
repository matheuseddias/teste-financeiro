import { useEffect, useState } from 'react';
import { defaultMapping, identifyRows, mapStatement, money, parseOfx, type ColumnMapping, type ImportRow, type RowIssue } from '@eddias/core';
import { useStore } from '../../domain/store';
import { message } from '../../data/client';
import { Notice } from '../../ui';
import { readSheets, type Sheet } from './readFile';
interface Preview { rows: ImportRow[]; skipped: RowIssue[]; ofxAccount?: string; ofxBank?: string }
interface Simulation { total: number; new: number; duplicates: number; possible_duplicates: number }
export function ImportStatement({ close }: { close: () => void }) {
  const { data, repo, mutate } = useStore(); const [accountId, setAccount] = useState(''); const [sheets, setSheets] = useState<Sheet[]>([]); const [sheetIndex, setSheet] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>(defaultMapping); const [preview, setPreview] = useState<Preview | null>(null); const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [error, setError] = useState(''); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false); const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [confirmed, setConfirmed] = useState(false); const [profileName, setProfileName] = useState(''); const [from, setFrom] = useState('2026-09-01'); const [to, setTo] = useState('');
  const account = data?.accounts.find(a => a.id === accountId); const sheet = sheets[sheetIndex];
  const visible = (preview?.rows || []).map((r, i) => ({ ...r, index: i })).filter(r => (!from || r.posted_date >= from) && (!to || r.posted_date <= to));
  const selected = visible.filter(r => !excluded.has(r.index)).map(({ index: _index, ...r }) => r);
  const existingKeys = new Set(data?.transactions.filter(t => t.account_id === accountId).map(t => t.source_key));
  const dirty = !!preview || sheets.length > 0;
  useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  function invalidate() { setSimulation(null); setConfirmed(false); setError(''); }
  async function prepare(valid: Parameters<typeof identifyRows>[0], skipped: RowIssue[], extras = {}) {
    const rows = await identifyRows(valid); setPreview({ rows, skipped, ...extras }); setExcluded(new Set()); invalidate();
  }
  return <section className="card editor"><h2>Importar extrato</h2><p>O arquivo permanece no navegador durante a prévia. Somente os movimentos selecionados serão gravados.</p>
    <form data-dirty={dirty} onSubmit={e => e.preventDefault()}><fieldset disabled={busy}><div className="form-grid"><label>Conta do extrato<select aria-label="Conta do extrato" required value={accountId} onChange={e => { setAccount(e.target.value); setSheets([]); setPreview(null); invalidate(); }}><option value="">Selecione a conta</option>{data?.accounts.map(a => <option value={a.id} key={a.id}>{a.name} · {data.companies.find(c => c.id === a.company_id)?.name}</option>)}</select></label>
      <label>Arquivo XLSX, CSV ou OFX<input disabled={!accountId || busy} type="file" accept=".xlsx,.csv,.ofx,.html,.htm,.xls" onChange={async e => {
        const file = e.target.files?.[0]; if (!file) return; setBusy(true); setError(''); setPreview(null); setSheets([]); invalidate();
        try {
          if (file.size > 8 * 1024 * 1024) throw new Error('Limite de 8 MB por arquivo.');
          if (/\.ofx$/i.test(file.name)) { const bytes = await file.arrayBuffer(); let text = new TextDecoder('utf-8').decode(bytes); if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(bytes); const p = parseOfx(text); await prepare(p.valid, p.skipped, { ofxAccount: p.account, ofxBank: p.bank }); }
          else { const list = await readSheets(file); setSheets(list); setSheet(0); setMapping(defaultMapping); }
        } catch (err) { setError(message(err)); } finally { setBusy(false); e.target.value = ''; }
      }} /></label></div>
      {sheet && <><div className="form-grid"><label>Aba / tabela<select value={sheetIndex} onChange={e => { setSheet(Number(e.target.value)); setPreview(null); invalidate(); }}>{sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></label>
        <label>Perfil salvo<select defaultValue="" onChange={e => { const p = data?.profiles.find(p => p.id === e.target.value); if (p) { setMapping(p.config); setPreview(null); invalidate(); } }}><option value="">Mapear agora</option>{data?.profiles.filter(p => p.account_id === accountId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Primeira linha de dados<input type="number" min="1" max={sheet.rows.length || 1} value={mapping.start + 1} onChange={e => { setMapping({ ...mapping, start: Math.max(0, Number(e.target.value) - 1) }); setPreview(null); invalidate(); }} /></label>
        <label>Formato dos valores em texto<select value={mapping.format} onChange={e => { setMapping({ ...mapping, format: e.target.value as 'br' | 'decimal' }); setPreview(null); invalidate(); }}><option value="br">Brasileiro: 1.234,56</option><option value="decimal">Ponto decimal: 1234.56</option></select></label>
        {(['date','description','amount','debit','credit','external'] as const).map(key => <label key={key}>{({ date: 'Coluna da data', description: 'Coluna da descrição', amount: 'Valor com sinal', debit: 'Débito (sem coluna de valor)', credit: 'Crédito (sem coluna de valor)', external: 'Identificador bancário (opcional)' })[key]}<select value={mapping[key]} onChange={e => { setMapping({ ...mapping, [key]: Number(e.target.value) }); setPreview(null); invalidate(); }}><option value="-1">Não utilizar</option>{Array.from({ length: Math.max(0, ...sheet.rows.slice(0, 50).map(r => r.length)) }, (_, i) => <option value={i} key={i}>Coluna {i + 1} · {String(sheet.rows[0]?.[i] ?? '').slice(0, 35) || 'Sem título'}</option>)}</select></label>)}</div>
        <label className="checkbox"><input type="checkbox" checked={mapping.fill_date} onChange={e => { setMapping({ ...mapping, fill_date: e.target.checked }); setPreview(null); invalidate(); }} />Repetir a última data nas linhas com data vazia</label>
        <label className="checkbox"><input type="checkbox" checked={mapping.invert} onChange={e => { setMapping({ ...mapping, invert: e.target.checked }); setPreview(null); invalidate(); }} />Inverter o sinal dos valores</label>
        <details><summary>Ver primeiras linhas do arquivo</summary><div className="table-scroll"><table className="data-table"><tbody>{sheet.rows.slice(0, 12).map((r, i) => <tr key={i}><th>Linha {i + 1}</th>{r.map((c, j) => <td key={j}>{c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '').slice(0, 90)}</td>)}</tr>)}</tbody></table></div></details>
        <button type="button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const p = mapStatement(sheet.rows, mapping); await prepare(p.valid, p.skipped); } catch (err) { setError(message(err)); } finally { setBusy(false); } }}>Gerar prévia</button>
        <div className="actions"><label>Nome do perfil<input maxLength={120} value={profileName} onChange={e => setProfileName(e.target.value)} /></label><button type="button" className="secondary" disabled={busy || !profileName.trim() || !preview} onClick={async () => { setBusy(true); setError(''); try { await mutate(() => repo.rpc('fin_save_import_profile', { p_id: crypto.randomUUID(), p_account_id: accountId, p_name: profileName, p_config: mapping })); setStatus('Perfil salvo para esta conta.'); } catch (err) { setError(message(err)); } finally { setBusy(false); } }}>Salvar perfil</button></div>
      </>}
      {preview && <><div className="form-grid"><label>Importar a partir de<input type="date" value={from} onChange={e => { setFrom(e.target.value); invalidate(); }} /></label><label>Até (opcional)<input type="date" value={to} onChange={e => { setTo(e.target.value); invalidate(); }} /></label></div>
        {preview.ofxAccount !== undefined && <Notice>OFX: banco {preview.ofxBank || 'não informado'} · conta {preview.ofxAccount || 'não informada'}. Destino: {account?.name} · conta {account?.account_number}. Confira a correspondência antes de confirmar.</Notice>}
        <p>{selected.length} movimentos selecionados. Soma com sinal: {money(selected.reduce((s, r) => s + r.amount_cents, 0))}.</p>
        <Notice>Sem identificador bancário, a deduplicação usa data, valor, descrição e ocorrência no arquivo. Revise lançamentos iguais e importações parciais. Abas com vários bancos devem ser importadas por conta, selecionando somente suas linhas.</Notice>
        <div className="actions"><button type="button" className="secondary" onClick={() => { setExcluded(new Set()); invalidate(); }}>Selecionar todos</button><button type="button" className="secondary" onClick={() => { setExcluded(new Set(preview.rows.map((_, i) => i))); invalidate(); }}>Desmarcar todos</button></div>
        <div className="table-scroll import-preview"><table className="data-table"><thead><tr><th>Importar</th><th>Data</th><th>Descrição</th><th>Valor</th><th>Identificação</th></tr></thead><tbody>{visible.slice(0, 2000).map(r => <tr key={r.index}><td><input type="checkbox" aria-label={'Selecionar movimento ' + (r.index + 1)} checked={!excluded.has(r.index)} onChange={e => { const next = new Set(excluded); if (e.target.checked) next.delete(r.index); else next.add(r.index); setExcluded(next); invalidate(); }} /></td><td>{r.posted_date.split('-').reverse().join('/')}</td><td>{r.description}</td><td className={r.amount_cents < 0 ? 'negative' : ''}>{money(r.amount_cents)}</td><td>{existingKeys.has(r.source_key) ? 'Já importado' : r.external_id || 'Identificação calculada'}</td></tr>)}</tbody></table></div>
        {visible.length > 2000 && <Notice error>Prévia limitada a 2000 linhas. Reduza o período antes de importar.</Notice>}
        {!!preview.skipped.length && <details><summary>{preview.skipped.length} linhas não reconhecidas / ignoradas</summary><ul>{preview.skipped.slice(0, 100).map((r, i) => <li key={i}>Linha {r.row}: {r.reason}</li>)}</ul></details>}
        <div className="actions"><button type="button" disabled={busy || selected.length < 1 || selected.length > 2000} onClick={async () => { setBusy(true); setError(''); try { setSimulation(await repo.rpc<Simulation>('fin_import_transactions', { p_account_id: accountId, p_rows: selected, p_dry_run: true })); setConfirmed(false); } catch (err) { setError(message(err)); } finally { setBusy(false); } }}>Verificar importação</button></div>
        {simulation && <><Notice>{simulation.new} novos · {simulation.duplicates} já existentes · {simulation.possible_duplicates} possíveis duplicatas com outro identificador. Nenhum existente será sobrescrito.</Notice>
          <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Conferi a conta, os valores, as linhas ignoradas e as possíveis duplicatas.</label>
          <button type="button" disabled={!confirmed || busy} onClick={async () => { setBusy(true); setError(''); try { await mutate(() => repo.rpc('fin_import_transactions', { p_account_id: accountId, p_rows: selected, p_dry_run: false })); close(); } catch (err) { setError(message(err)); } finally { setBusy(false); } }}>Confirmar importação</button></>}
      </>}
      {busy && <p role="status">Processando…</p>}{error && <Notice error>{error}</Notice>}{status && <Notice>{status}</Notice>}
      <div className="actions"><button type="button" className="secondary" onClick={() => { if (!dirty || window.confirm('Fechar a prévia? Será necessário selecionar o arquivo novamente.')) close(); }}>Fechar importação</button></div>
    </fieldset></form></section>;
}
