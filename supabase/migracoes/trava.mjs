#!/usr/bin/env node
// Trava das migrations: decide, só lendo o texto, se um arquivo pode ser aplicado sozinho em produção.
//
// Recusa sempre (estrutural): BEGIN/COMMIT/ROLLBACK/SAVEPOINT próprios (o aplicador já abre uma
// transação por arquivo; um COMMIT no meio gravaria metade), CONCURRENTLY (não roda em transação) e
// meta-comando do psql (\i, \set ON_ERROR_STOP off, \c …).
// Recusa sem a linha `-- financeiro:destrutiva-aprovada: <motivo>` (destrutiva): DROP TABLE/SCHEMA/OWNED/
// SEQUENCE, DROP … CASCADE, ALTER TABLE … DROP [COLUMN], ALTER COLUMN … TYPE, RENAME, SET SCHEMA,
// TRUNCATE, DELETE, UPDATE, INSERT … ON CONFLICT DO UPDATE (sobrescreve linha existente), MERGE com
// UPDATE/DELETE, CALL, setval() e RESTART de sequência (a numeração volta e repete chave).
//
// O que conta: comando de nível zero, corpo de DO (executa na hora) e o SQL dinâmico dentro dele, e o
// corpo de função criada no próprio arquivo quando o arquivo a chama (SELECT/PERFORM/CALL, e também
// DEFAULT/CHECK de ALTER TABLE e CREATE TABLE … AS, que rodam sobre as linhas na hora). O que não
// conta: comentário, string comum e corpo de CREATE FUNCTION que o arquivo não chama — ele só roda
// depois, quando alguém chamar a função, e é assim que toda RPC do Financeiro grava.
// Limite (documentado em docs/publicacao-automatica.md): função que já existe no banco e é chamada pelo
// arquivo não tem o corpo lido; a trava então exige a aprovação, seja `public.f()` ou `f()` sem schema
// (o aplicador passa em --funcoes-public os nomes que existem em public no banco-alvo; função criada por
// outro arquivo pendente conta igual). O ensaio e o backup cobrem o resto.
//
// Uso: node supabase/migracoes/trava.mjs [--json] [--funcoes-public nomes.txt] arquivo.sql…
//   (saída 0 = pode aplicar; 3 = recusado)
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { comandos, corpoAtomico, ehCriacaoDeFuncao, ErroLexico, nomeDaFuncao, palavra, tokenizar } from './lexico.mjs'

const APROVACAO = /^--\s*financeiro:destrutiva-aprovada:(.*)$/
const CONTROLE_TRANSACAO = new Set(['begin', 'commit', 'end', 'rollback', 'abort', 'savepoint', 'release'])
// Palavra antes de `nome (` que diz que não é chamada: INSERT INTO t (colunas), REFERENCES t (id)…
const NAO_E_CHAMADA = new Set(['into', 'table', 'references', 'on', 'update', 'only', 'index', 'view', 'function', 'procedure', 'trigger', 'type', 'as'])
const EXECUTAM = new Set(['select', 'with', 'insert', 'values', 'perform', 'call', 'update', 'delete', 'merge'])
const DDL = new Set(['create', 'alter', 'grant', 'revoke', 'comment', 'drop'])
const VERBOS = new Set([...EXECUTAM, ...DDL, 'execute'])
const DROP_SEGURO_EM_ALTER_TABLE = new Set(['constraint', 'default', 'not', 'expression', 'identity'])

/**
 * @param {string} texto conteúdo do arquivo
 * @param {{ funcoesPublic?: Set<string> }} [opcoes] nomes (minúsculos) de funções que existem em public no
 *   banco-alvo ou que outro arquivo pendente cria: chamá-las sem schema resolve para public e pede aprovação.
 * @returns {{ estruturais: Achado[], destrutivas: Achado[], aprovacao: string|null, recusado: boolean }}
 * @typedef {{ linha: number, regra: string, trecho: string }} Achado
 */
export function analisar(texto, opcoes = {}) {
  const limpo = texto.replace(/^\uFEFF/, '')
  const estruturais = []
  const destrutivas = []
  let tokens
  try {
    tokens = tokenizar(limpo)
  } catch (e) {
    if (!(e instanceof ErroLexico)) throw e
    return { estruturais: [{ linha: e.linha, regra: `não consegui ler o SQL (${e.message})`, trecho: '' }], destrutivas, aprovacao: null, recusado: true }
  }

  let aprovacao = null
  for (const t of tokens) {
    if (t.tipo !== 'comentario') continue
    const m = APROVACAO.exec(t.valor)
    if (!m) continue
    if (!m[1].trim()) estruturais.push({ linha: t.linha, regra: 'linha de aprovação sem motivo (escreva o porquê depois dos dois-pontos)', trecho: '' })
    else aprovacao = m[1].trim()
  }
  for (const t of tokens) {
    if (t.tipo === 'meta') estruturais.push({ linha: t.linha, regra: 'meta-comando do psql (o aplicador roda o arquivo como SQL puro)', trecho: t.valor.slice(0, 60) })
  }

  const cmds = comandos(tokens)
  const funcoes = new Map() // nome → comandos do corpo, para abrir quando o próprio arquivo chamar
  for (const cmd of cmds) {
    if (!ehCriacaoDeFuncao(cmd)) continue
    // corpo em string ($$…$$, '…') ou SQL padrão (BEGIN ATOMIC … END), que não é string
    const atomico = corpoAtomico(cmd, limpo)
    const corpo = atomico ? [atomico] : cmd.filter((t) => t.tipo === 'dolar' || t.tipo === 'string')
    funcoes.set(nomeDaFuncao(cmd), { cmd, corpo })
  }

  const funcoesPublic = opcoes.funcoesPublic ?? new Set()
  const ctx = { texto: limpo, destrutivas, estruturais, funcoes, funcoesPublic, abertas: new Set() }
  for (const cmd of cmds) {
    const primeira = cmd[0]
    if (ehControleDeTransacao(cmd)) {
      estruturais.push({ linha: primeira.linha, regra: 'controle de transação próprio (o aplicador já roda cada arquivo numa transação)', trecho: trecho(limpo, cmd) })
      continue
    }
    // corpo de função (inclusive BEGIN ATOMIC) não roda agora: só quando alguém chamar
    if (ehCriacaoDeFuncao(cmd)) continue
    if (palavra(primeira, 'do')) {
      for (const t of cmd) if (t.tipo === 'dolar' || t.tipo === 'string') executavel(t.valor, t.linha, ctx, 'bloco DO')
      continue
    }
    regras(cmd, ctx, { texto: limpo, deslocamento: 0, origem: null, dinamico: false })
  }
  const recusado = estruturais.length > 0 || (destrutivas.length > 0 && !aprovacao)
  return { estruturais, destrutivas, aprovacao, recusado }
}

// Texto que executa na hora (corpo de DO, SQL dinâmico, função chamada pelo arquivo): mesmas regras,
// e as strings dele também são lidas como SQL, porque podem ir para um EXECUTE.
// Corpo (de DO ou de função chamada) que não dá para ler é recusado: não se aprova o que não se leu.
// String dentro dele que não é SQL (mensagem, formato) só é ignorada.
function executavel(texto, linhaBase, ctx, origem, corpo = true) {
  let tokens
  try {
    tokens = tokenizar(texto)
  } catch (e) {
    if (corpo) ctx.estruturais.push({ linha: linhaBase, regra: `não consegui ler o corpo (${origem}): ${e.message}`, trecho: '' })
    return
  }
  const local = { texto, deslocamento: linhaBase - 1, origem, dinamico: true }
  for (const cmd of comandos(tokens)) {
    if (palavra(cmd[0], 'commit') || palavra(cmd[0], 'rollback')) {
      ctx.estruturais.push(achado(cmd[0], `controle de transação dentro de ${origem}`, local, cmd))
      continue
    }
    regras(cmd, ctx, local)
    for (const t of cmd) {
      if (t.tipo === 'dolar' || t.tipo === 'string') executavel(t.valor, t.linha + local.deslocamento, ctx, origem, false)
    }
  }
}

function regras(cmd, ctx, local) {
  const d = (t, regra) => ctx.destrutivas.push(achado(t, regra, local, cmd))
  // No plpgsql o comando pode vir depois de BEGIN/THEN/LOOP no mesmo trecho: o início é o primeiro verbo.
  const inicio = local.dinamico ? Math.max(0, cmd.findIndex((x) => palavra(x) && VERBOS.has(x.valor))) : 0
  const p0 = cmd[inicio]
  const alterTable = palavra(p0, 'alter') && (palavra(cmd[inicio + 1], 'table') || (palavra(cmd[inicio + 1], 'foreign') && palavra(cmd[inicio + 2], 'table')))

  for (let i = 0; i < cmd.length; i++) {
    const t = cmd[i]
    if (!palavra(t)) continue
    const ant = cmd[i - 1]
    const prox = cmd[i + 1]
    const fimDoTexto = prox === undefined && local.dinamico
    switch (t.valor) {
      case 'concurrently':
        ctx.estruturais.push(achado(t, 'CONCURRENTLY (não roda dentro de transação)', local, cmd))
        break
      case 'drop':
        if (palavra(prox, 'table') || (palavra(prox, 'foreign') && palavra(cmd[i + 2], 'table'))) d(t, 'DROP TABLE')
        else if (palavra(prox, 'schema')) d(t, 'DROP SCHEMA')
        else if (palavra(prox, 'owned')) d(t, 'DROP OWNED')
        else if (palavra(prox, 'sequence')) d(t, 'DROP SEQUENCE (perde a numeração)')
        else if (palavra(prox, 'database')) d(t, 'DROP DATABASE')
        else if (palavra(prox, 'attribute')) d(t, 'DROP ATTRIBUTE (coluna de tipo composto)')
        else if (alterTable && !(palavra(prox) && DROP_SEGURO_EM_ALTER_TABLE.has(prox.valor))) d(t, 'DROP COLUMN')
        else if (i === inicio && cmd.some((x) => palavra(x, 'cascade'))) d(t, 'DROP … CASCADE (leva junto o que depende)')
        else if (fimDoTexto) d(t, 'DROP em SQL dinâmico montado por concatenação')
        break
      case 'type':
        if (alterTable && ((palavra(ant, 'data') && palavra(cmd[i - 2], 'set'))
          || (nomeOuIdent(ant) && (palavra(cmd[i - 2], 'column') || palavra(cmd[i - 2], 'alter'))))) d(t, 'ALTER COLUMN … TYPE')
        break
      case 'rename':
        d(t, 'RENAME')
        break
      case 'schema':
        // ALTER TABLE/FUNCTION … SET SCHEMA: o objeto some de public, como num RENAME
        if (palavra(p0, 'alter') && palavra(ant, 'set')) d(t, 'SET SCHEMA (tira o objeto do lugar, como RENAME)')
        break
      case 'restart':
        // ALTER SEQUENCE … RESTART e ALTER TABLE … ALTER COLUMN id RESTART: números já usados voltam a sair
        if (palavra(p0, 'alter')) d(t, 'RESTART de sequência (a numeração volta e repete chave)')
        break
      case 'truncate':
        if (!(prox && ['on', 'or', ',', ')'].includes(prox.valor))) d(t, 'TRUNCATE')
        break
      case 'delete':
        if (palavra(prox, 'from') || palavra(ant, 'then') || fimDoTexto) d(t, 'DELETE')
        break
      case 'update':
        if (palavra(ant, 'do') && palavra(prox, 'set')) d(t, 'INSERT … ON CONFLICT DO UPDATE (sobrescreve linha existente)')
        else if (palavra(ant, 'then')) d(t, 'UPDATE (MERGE)')
        else if (ehUpdate(cmd, i) || (fimDoTexto && !palavra(ant, 'for'))) d(t, 'UPDATE')
        break
      default:
        break
    }
  }
  // Chamadas: só em comando que executa agora (SELECT, INSERT…). Em texto executável (DO, dinâmico) o
  // verbo é o primeiro que aparece depois do IF/BEGIN/THEN do plpgsql; DDL (CREATE POLICY … USING
  // (public.f())) só guarda a chamada para depois. Exceção: ALTER TABLE (DEFAULT, CHECK e USING rodam
  // sobre cada linha que já existe) e CREATE TABLE/MATERIALIZED VIEW … AS (roda a consulta agora).
  const ddlQueExecuta = alterTable || criaComConsulta(cmd, inicio)
  const executa = palavra(p0) && DDL.has(p0.valor) ? ddlQueExecuta : (local.dinamico || (palavra(p0) && EXECUTAM.has(p0.valor)))
  if (!executa) return
  for (let k = 1; k < cmd.length; k++) {
    if (cmd[k].tipo !== 'simbolo' || cmd[k].valor !== '(' || !nomeOuIdent(cmd[k - 1])) continue
    const nome = cmd[k - 1]
    let inicio = k - 1
    let schema = null
    if (cmd[k - 2]?.valor === '.' && nomeOuIdent(cmd[k - 3])) { schema = cmd[k - 3].valor.toLowerCase(); inicio = k - 3 }
    const antes = cmd[inicio - 1]
    const ehCall = palavra(antes, 'call')
    if (!ehCall && palavra(antes) && NAO_E_CHAMADA.has(antes.valor)) continue
    chamada(nome, schema, ehCall, ctx, local, cmd)
  }
}

// Chamada a função ou procedimento. Criada no próprio arquivo: lê o corpo, porque ele roda agora.
// De public e já existente no banco: a trava não vê o corpo e pede aprovação — com `public.` ou sem
// schema (o search_path do aplicador tem public, então `f()` é `public.f()` quando ela existe lá).
// Sem schema e fora de public, ou de outro schema (pg_catalog, extensions): função do sistema, format(),
// now(), set_config()… Exceção: setval() mexe na numeração.
function chamada(nome, schema, ehCall, ctx, local, cmd) {
  const chave = nome.tipo === 'ident' ? nome.valor : nome.valor.toLowerCase()
  const propria = ctx.funcoes.get(chave)
  if (propria && (schema === null || schema === 'public')) {
    if (ctx.abertas.has(chave)) return
    ctx.abertas.add(chave)
    for (const t of propria.corpo) executavel(t.valor, t.linha, ctx, `${chave}(), criada e chamada neste arquivo`)
    return
  }
  const d = (regra) => ctx.destrutivas.push(achado(nome, regra, local, cmd))
  if (ehCall) d('CALL de procedimento que a trava não enxerga')
  else if (schema === 'public') d(`chama public.${chave}(), que já existe no banco (a trava não vê o que ela faz)`)
  else if (schema === null && ctx.funcoesPublic.has(chave)) d(`chama ${chave}() sem schema, que é public.${chave}() (a trava não vê o que ela faz)`)
  else if (chave === 'setval' && (schema === null || schema === 'pg_catalog')) d('setval() (a numeração volta e repete chave)')
}

// CREATE [OR REPLACE] [TEMP|UNLOGGED] TABLE … AS <consulta> e CREATE MATERIALIZED VIEW … AS <consulta>:
// a consulta roda agora. (`GENERATED … AS (expr)` também casa: expressão de coluna gerada é imutável.)
function criaComConsulta(cmd, inicio) {
  if (!palavra(cmd[inicio], 'create')) return false
  if (!cmd.some((t, k) => k > inicio && (palavra(t, 'table') || palavra(t, 'materialized')))) return false
  const CONSULTA = new Set(['select', 'with', 'values', 'table', 'execute'])
  return cmd.some((t, k) => palavra(t, 'as') && (
    (palavra(cmd[k + 1]) && CONSULTA.has(cmd[k + 1].valor))
    || (cmd[k + 1]?.valor === '(' && palavra(cmd[k + 2]) && CONSULTA.has(cmd[k + 2].valor))))
}

// UPDATE [ONLY] nome[.nome…] [*] [[AS] apelido] SET
function ehUpdate(cmd, i) {
  let j = i + 1
  if (palavra(cmd[j], 'only')) j++
  if (!nomeOuIdent(cmd[j]) || palavra(cmd[j], 'set')) return false
  j++
  while (cmd[j]?.valor === '.' && nomeOuIdent(cmd[j + 1])) j += 2
  if (cmd[j]?.valor === '*') j++
  if (palavra(cmd[j], 'as')) j++
  if (nomeOuIdent(cmd[j]) && !palavra(cmd[j], 'set')) j++
  return palavra(cmd[j], 'set')
}

function ehControleDeTransacao(cmd) {
  const p = cmd[0]
  if (!palavra(p)) return false
  if (CONTROLE_TRANSACAO.has(p.valor)) return true
  return (p.valor === 'start' || p.valor === 'prepare') && palavra(cmd[1], 'transaction')
}

const nomeOuIdent = (t) => t !== undefined && (t.tipo === 'palavra' || t.tipo === 'ident')

function achado(t, regra, local, cmd) {
  const linha = t.linha + local.deslocamento
  const onde = local.origem ? ` [${local.origem}]` : ''
  return { linha, regra: regra + onde, trecho: trecho(local.texto, cmd) }
}

function trecho(texto, cmd) {
  const bruto = texto.slice(cmd[0].inicio, cmd[cmd.length - 1].fim).replace(/\s+/g, ' ').trim()
  return bruto.length > 90 ? bruto.slice(0, 87) + '…' : bruto
}

/** Nomes (minúsculos, sem schema) das funções e procedimentos que o texto cria. */
export function funcoesCriadas(texto) {
  try {
    return comandos(tokenizar(texto.replace(/^﻿/, ''))).filter(ehCriacaoDeFuncao).map(nomeDaFuncao).filter(Boolean)
  } catch (e) {
    if (e instanceof ErroLexico) return [] // o analisar() do próprio arquivo recusa
    throw e
  }
}

/** Texto para o log do aplicador. */
export function relatorio(nome, r) {
  const linhas = []
  const lista = (achados) => {
    const vistos = new Set()
    for (const a of achados) {
      const chave = `${a.linha}|${a.regra}`
      if (vistos.has(chave)) continue
      vistos.add(chave)
      linhas.push(`    linha ${a.linha}: ${a.regra}${a.trecho ? ` — ${a.trecho}` : ''}`)
    }
  }
  if (r.estruturais.length) {
    linhas.push(`RECUSADO ${nome}: não pode rodar numa transação do aplicador`)
    lista(r.estruturais)
  }
  if (r.destrutivas.length && !r.aprovacao) {
    linhas.push(`RECUSADO ${nome}: comando destrutivo sem a linha "-- financeiro:destrutiva-aprovada: <motivo>"`)
    lista(r.destrutivas)
  } else if (r.destrutivas.length && !r.estruturais.length) {
    linhas.push(`APROVADO ${nome}: destrutiva aprovada — ${r.aprovacao}`)
    lista(r.destrutivas)
  }
  if (!r.recusado && !r.destrutivas.length) linhas.push(`OK ${nome}`)
  return linhas.join('\n')
}

function principal(args) {
  const resto = [...args]
  let json = false
  const funcoesPublic = new Set()
  while (resto[0]?.startsWith('--')) {
    const opcao = resto.shift()
    if (opcao === '--json') json = true
    else if (opcao === '--funcoes-public' && resto.length) {
      for (const n of readFileSync(resto.shift(), 'utf8').split('\n')) if (n.trim()) funcoesPublic.add(n.trim())
    } else {
      console.error(`opção desconhecida: ${opcao}`)
      return 2
    }
  }
  const arquivos = resto
  if (!arquivos.length) {
    console.error('uso: node supabase/migracoes/trava.mjs [--json] [--funcoes-public nomes.txt] arquivo.sql…')
    return 2
  }
  // Função criada por um arquivo pendente e chamada por outro: o corpo não é lido (roda noutro arquivo),
  // então conta como já existente.
  const textos = arquivos.map((arquivo) => readFileSync(arquivo, 'utf8'))
  for (const texto of textos) for (const nome of funcoesCriadas(texto)) funcoesPublic.add(nome)
  let recusou = false
  const saida = {}
  for (const [i, arquivo] of arquivos.entries()) {
    const r = analisar(textos[i], { funcoesPublic })
    recusou ||= r.recusado
    if (json) saida[basename(arquivo)] = r
    else console.log(relatorio(basename(arquivo), r))
  }
  if (json) console.log(JSON.stringify(saida, null, 2))
  return recusou ? 3 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = principal(process.argv.slice(2))
