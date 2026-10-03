import { MAX_CENTS, type KaminoDocumentData } from '../../../../packages/core/src/index';
export const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const invalid = () => new Error('Kamino: formato não reconhecido. Sincronização interrompida para revisão.');
function text(v: unknown, max = 120): string | null {
 if (v === null || v === undefined || v === '') return null;
 if (typeof v !== 'string' && typeof v !== 'number') throw invalid();
 return String(v).trim().slice(0, max) || null;
}
function id(v: unknown): string { const s = text(v, 80); if (!s || !/^[1-9]\d*$/.test(s)) throw invalid(); return s; }
function date(v: unknown): string | null {
 if (v === null || v === undefined || v === '') return null;
 if (typeof v !== 'string') throw invalid();
 const d = v.slice(0,10); if (!/^20\d{2}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10) !== d) throw invalid(); return d;
}
export function cents(v: unknown): number {
 const s = typeof v === 'number' || typeof v === 'string' ? String(v) : '';
 if (!/^\d+(?:\.\d+)?$/.test(s)) throw invalid();
 const [whole, fraction = ''] = s.split('.');
 const value = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0,2)) + (Number(fraction[2] || 0) >= 5 ? 1n : 0n);
 if (value > BigInt(MAX_CENTS)) throw invalid(); return Number(value);
}
export function payment(v: unknown): KaminoDocumentData {
 if (!obj(v) || ![1,2,3].includes(Number(v.Situacao)) || !['R$','BRL'].includes(String(v.SimbMoeda))) throw invalid();
 const due = date(v.DataVencimento); if (!due) throw invalid();
 return { source_id:id(v.ID), description:text(v.Descricao) || text(v.NomePessoa) || 'Conta a pagar Kamino', due_date:due, issue_date:date(v.DataCompetencia),
  amount_cents:cents(v.ValorVencimento), paid_cents:v.ValorPagamento == null ? null : cents(v.ValorPagamento), status:String(v.Situacao), unit_id:text(v.IDUnidadeNegocio), unit_name:text(v.NomeUnidadeNegocio),
  supplier:text(v.NomePessoa), supplier_document:text(v.CPFCNPJPessoa), invoice_number:text(v.NroNotaFiscal), invoice_key:null, invoice_source_id:text(v.IDNotaFiscalEntrada), category_key:text(v.IDPlanoContaClassificacao) };
}
export function invoice(v: unknown): KaminoDocumentData {
 if (!obj(v)) throw invalid();
 const key = text(v.ChaveAcessoNF,200); const issued = date(v.DataHoraEmissao);
 if (!key || !/^\d{44}$/.test(key) || !issued) throw invalid();
 return { source_id:id(v.ID), description:'NF-e ' + (text(v.NumeroNotaFiscal) || key.slice(-9)), due_date:null,issue_date:issued,amount_cents:cents(v.ValorTotal),paid_cents:null,
  status:text(v.NomeSituacao) || 'Informada pela Kamino',unit_id:text(v.IDUnidadeNegocio), unit_name:text(v.NomeUnidadeNegocio),supplier:text(v.RazaoSocialFornecedor),supplier_document:text(v.CNPJFornecedor),invoice_number:text(v.NumeroNotaFiscal),invoice_key:key,invoice_source_id:null,category_key:null };
}
export function paymentPage(body: unknown, page: number, size: number) {
 if (!obj(body) || !Array.isArray(body.Dados) || body.PaginaAtual !== page || body.TamanhoPagina !== size ||
  !Number.isSafeInteger(body.TotalPaginas) || Number(body.TotalPaginas) < 0 || !Number.isSafeInteger(body.TotalLinhas) || Number(body.TotalLinhas) < 0 || body.Dados.length > size) throw invalid();
 const pages = Number(body.TotalPaginas), total = Number(body.TotalLinhas);
 if ((pages !== Math.ceil(total / size) && !(total === 0 && pages === 1)) || (page < pages && body.Dados.length !== size) || (total > 0 && page <= pages && !body.Dados.length)) throw invalid();
 return { documents:body.Dados.map(payment), done:page >= pages, pages };
}
export function invoiceList(body: unknown) {
 const list = Array.isArray(body) ? body : obj(body) ? body.Dados : null;
 if (!Array.isArray(list) || list.some(v => !obj(v))) throw invalid();
 return list.map(invoice);
}
export async function fingerprints(documents: KaminoDocumentData[]) {
 if (new Set(documents.map(d => d.source_id)).size !== documents.length) throw invalid();
 return Promise.all(documents.map(async d => ({ ...d, fingerprint:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(d))))].map(x=>x.toString(16).padStart(2,'0')).join('') })));
}
