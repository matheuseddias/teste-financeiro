// Léxico de SQL do PostgreSQL para a trava de migrations (supabase/migracoes/trava.mjs).
// Não é um parser: separa o texto em tokens sabendo onde começam e terminam comentários, strings
// ('…', E'…' com barra invertida, "identificador", $tag$…$tag$) e meta-comandos do psql, e divide em
// comandos pelo ';' de nível zero. É o suficiente para a trava olhar só o que o Postgres executa:
// comentário nunca conta, e corpo de função é um token de string que a trava decide se abre ou não.

const INICIO_PALAVRA = /[A-Za-z_\u0080-￿]/
const RESTO_PALAVRA = /[A-Za-z0-9_$\u0080-￿]/
const PREFIXOS_STRING = new Set(['e', 'b', 'x', 'n'])

/**
 * @typedef {{ tipo: 'palavra'|'ident'|'string'|'dolar'|'numero'|'simbolo'|'meta'|'comentario',
 *   valor: string, inicio: number, fim: number, linha: number }} Token
 * palavra: minúsculas (palavra-chave ou identificador sem aspas); ident: "entre aspas", sem as aspas;
 * string e dolar: o conteúdo, sem os delimitadores; comentario: o texto inteiro, com -- ou /* *\/.
 */

/** @param {string} texto @returns {Token[]} */
export function tokenizar(texto) {
  const tokens = []
  let i = 0
  let linha = 1
  const n = texto.length
  const avancar = (ate) => {
    for (let k = i; k < ate; k++) if (texto[k] === '\n') linha++
    i = ate
  }
  const empurrar = (tipo, valor, inicio, fim, linhaInicio) => tokens.push({ tipo, valor, inicio, fim, linha: linhaInicio })

  while (i < n) {
    const c = texto[i]
    const inicio = i
    const linhaInicio = linha
    if (/\s/.test(c)) { avancar(i + 1); continue }

    // comentário de linha
    if (c === '-' && texto[i + 1] === '-') {
      let fim = texto.indexOf('\n', i)
      if (fim < 0) fim = n
      empurrar('comentario', texto.slice(i, fim).replace(/\r$/, ''), inicio, fim, linhaInicio)
      avancar(fim)
      continue
    }
    // comentário de bloco, com aninhamento (o Postgres aceita /* /* */ */)
    if (c === '/' && texto[i + 1] === '*') {
      let profundidade = 0
      let k = i
      while (k < n) {
        if (texto[k] === '/' && texto[k + 1] === '*') { profundidade++; k += 2; continue }
        if (texto[k] === '*' && texto[k + 1] === '/') { profundidade--; k += 2; if (profundidade === 0) break; continue }
        k++
      }
      if (profundidade !== 0) throw new ErroLexico('comentário /* sem fechamento', linhaInicio)
      empurrar('comentario', texto.slice(i, k), inicio, k, linhaInicio)
      avancar(k)
      continue
    }
    // meta-comando do psql: da barra invertida até o fim da linha
    if (c === '\\') {
      let fim = texto.indexOf('\n', i)
      if (fim < 0) fim = n
      empurrar('meta', texto.slice(i, fim).replace(/\r$/, ''), inicio, fim, linhaInicio)
      avancar(fim)
      continue
    }
    // string com prefixo: E'…' (barra invertida escapa), B'…', X'…', N'…', U&'…'
    if (PREFIXOS_STRING.has(c.toLowerCase()) && texto[i + 1] === "'") {
      const { fim, valor } = lerAspasSimples(texto, i + 1, c.toLowerCase() === 'e', linhaInicio)
      empurrar('string', valor, inicio, fim, linhaInicio)
      avancar(fim)
      continue
    }
    if ((c === 'u' || c === 'U') && texto[i + 1] === '&' && (texto[i + 2] === "'" || texto[i + 2] === '"')) {
      if (texto[i + 2] === "'") {
        const { fim, valor } = lerAspasSimples(texto, i + 2, false, linhaInicio)
        empurrar('string', valor, inicio, fim, linhaInicio)
        avancar(fim)
      } else {
        const { fim, valor } = lerAspasDuplas(texto, i + 2, linhaInicio)
        empurrar('ident', valor, inicio, fim, linhaInicio)
        avancar(fim)
      }
      continue
    }
    if (c === "'") {
      const { fim, valor } = lerAspasSimples(texto, i, false, linhaInicio)
      empurrar('string', valor, inicio, fim, linhaInicio)
      avancar(fim)
      continue
    }
    if (c === '"') {
      const { fim, valor } = lerAspasDuplas(texto, i, linhaInicio)
      empurrar('ident', valor, inicio, fim, linhaInicio)
      avancar(fim)
      continue
    }
    // $tag$ … $tag$ (tag vazia ou identificador); $1 é parâmetro, não abre string
    if (c === '$') {
      const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(texto.slice(i, i + 80))
      if (m) {
        const marca = m[0]
        const fimConteudo = texto.indexOf(marca, i + marca.length)
        if (fimConteudo < 0) throw new ErroLexico(`string ${marca} sem fechamento`, linhaInicio)
        empurrar('dolar', texto.slice(i + marca.length, fimConteudo), inicio, fimConteudo + marca.length, linhaInicio)
        avancar(fimConteudo + marca.length)
        continue
      }
    }
    if (INICIO_PALAVRA.test(c)) {
      let k = i + 1
      while (k < n && RESTO_PALAVRA.test(texto[k])) k++
      empurrar('palavra', texto.slice(i, k).toLowerCase(), inicio, k, linhaInicio)
      avancar(k)
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(texto[i + 1] ?? ''))) {
      let k = i + 1
      while (k < n && /[0-9.eE_]/.test(texto[k])) k++
      empurrar('numero', texto.slice(i, k), inicio, k, linhaInicio)
      avancar(k)
      continue
    }
    empurrar('simbolo', c, inicio, i + 1, linhaInicio)
    avancar(i + 1)
  }
  return tokens
}

function lerAspasSimples(texto, abre, barraEscapa, linha) {
  let k = abre + 1
  let valor = ''
  while (k < texto.length) {
    const c = texto[k]
    if (barraEscapa && c === '\\') { valor += texto.slice(k, k + 2); k += 2; continue }
    if (c === "'") {
      if (texto[k + 1] === "'") { valor += "'"; k += 2; continue }
      return { fim: k + 1, valor }
    }
    valor += c
    k++
  }
  throw new ErroLexico("string '…' sem fechamento", linha)
}

function lerAspasDuplas(texto, abre, linha) {
  let k = abre + 1
  let valor = ''
  while (k < texto.length) {
    if (texto[k] === '"') {
      if (texto[k + 1] === '"') { valor += '"'; k += 2; continue }
      return { fim: k + 1, valor }
    }
    valor += texto[k]
    k++
  }
  throw new ErroLexico('identificador "…" sem fechamento', linha)
}

export class ErroLexico extends Error {
  constructor(mensagem, linha) {
    super(`linha ${linha}: ${mensagem}`)
    this.linha = linha
  }
}

const palavra = (t, v) => t !== undefined && t.tipo === 'palavra' && (v === undefined || t.valor === v)

/**
 * Divide os tokens (sem comentários) em comandos pelo ';' de nível zero. O corpo SQL padrão de função
 * (`BEGIN ATOMIC … END`) tem ';' dentro e fica inteiro no mesmo comando.
 * @param {Token[]} tokens @returns {Token[][]}
 */
export function comandos(tokens) {
  const lista = []
  let atual = []
  let atomico = 0
  for (const t of tokens) {
    if (t.tipo === 'comentario') continue
    if (t.tipo === 'simbolo' && t.valor === ';' && atomico === 0) {
      if (atual.length) lista.push(atual)
      atual = []
      continue
    }
    atual.push(t)
    if (!ehCriacaoDeFuncao(atual)) continue
    const k = atual.length - 1
    if (palavra(t, 'atomic') && palavra(atual[k - 1], 'begin')) atomico++
    else if (atomico > 0 && palavra(t, 'case')) atomico++
    else if (atomico > 0 && palavra(t, 'end')) atomico--
  }
  if (atual.length) lista.push(atual)
  return lista
}

/** CREATE [OR REPLACE] FUNCTION|PROCEDURE */
export function ehCriacaoDeFuncao(cmd) {
  if (!palavra(cmd[0], 'create')) return false
  let k = 1
  if (palavra(cmd[k], 'or') && palavra(cmd[k + 1], 'replace')) k += 2
  return palavra(cmd[k], 'function') || palavra(cmd[k], 'procedure')
}

/**
 * Corpo SQL padrão (`BEGIN ATOMIC … END`) de uma criação de função, como texto: ele não é string, então
 * a trava precisa do trecho para ler quando o próprio arquivo chama a função. null se o corpo é string.
 * @param {Token[]} cmd @param {string} texto @returns {{ valor: string, linha: number }|null}
 */
export function corpoAtomico(cmd, texto) {
  const k = cmd.findIndex((t, i) => palavra(t, 'atomic') && palavra(cmd[i - 1], 'begin'))
  if (k < 0 || k + 1 >= cmd.length) return null
  const ultimo = cmd[cmd.length - 1]
  const fim = palavra(ultimo, 'end') ? ultimo.inicio : ultimo.fim
  return { valor: texto.slice(cmd[k + 1].inicio, fim), linha: cmd[k + 1].linha }
}

/** Nome (sem schema, minúsculo) da função criada pelo comando. */
export function nomeDaFuncao(cmd) {
  const k = cmd.findIndex((t) => palavra(t, 'function') || palavra(t, 'procedure'))
  let j = k + 1
  let nome = cmd[j]
  while (cmd[j + 1]?.tipo === 'simbolo' && cmd[j + 1].valor === '.') { j += 2; nome = cmd[j] }
  return nome ? (nome.tipo === 'ident' ? nome.valor : nome.valor.toLowerCase()) : ''
}

export { palavra }
