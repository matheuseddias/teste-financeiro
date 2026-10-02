#!/usr/bin/env bash
# Aplica as migrations pendentes de supabase/migrations num Postgres, cada arquivo na sua transação,
# registrando em financeiro_admin.migracoes (arquivo, sha256, quando, commit) na MESMA transação.
#
# Uso:  BANCO_URL='postgres://…' bash supabase/aplicar-migracoes.sh [--simular]
#   --simular   só lê: lista o que aplicaria e o que a trava recusaria; não cria nem grava nada.
# Variáveis:
#   BANCO_URL        obrigatória. No Supabase, a do Session pooler (porta 5432): o GitHub Actions não
#                    tem IPv6 e a conexão direta é IPv6; a porta 6543 (transaction) perde a trava de sessão.
#   COMMIT           commit que está sendo aplicado (padrão: git rev-parse HEAD).
#   MIGRACOES_DIR    pasta das migrations (padrão supabase/migrations; os testes apontam para outra).
#   APLICADOR_SAIDA  arquivo onde anexar pendentes=N, primeira_execucao=sim|nao, pg_major=NN ($GITHUB_OUTPUT).
#   MIGRACAO_LOCK_TIMEOUT (10s) e MIGRACAO_STATEMENT_TIMEOUT (15min): por arquivo; estourou, desfaz o arquivo.
#
# Para (sem aplicar nada) quando: arquivo já aplicado mudou de sha256 (migration aplicada não se edita),
# arquivo aplicado sumiu do repositório, arquivo novo tem data anterior à última aplicada, nome fora do
# padrão AAAAMMDDhhmmss_nome.sql, ou a trava (supabase/migracoes/trava.mjs) recusou algum pendente.
# Primeira execução num banco que já tem o schema (as 20260921* foram aplicadas à mão) e controle vazio:
# reaplica as que existiam antes do aplicador, e cada uma só é gravada se a impressão digital dos dados de
# public for a mesma antes e depois dela, na mesma transação. As posteriores entram como numa execução
# normal. Detalhes e provas: docs/publicacao-automatica.md, seção 3.
set -euo pipefail
export LC_COLLATE=C # ordem dos arquivos e comparação "<" byte a byte, igual à do banco (collate "C")
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
MIGRACOES_DIR="${MIGRACOES_DIR:-$RAIZ/supabase/migrations}"
SIMULAR=""
[[ "${1:-}" == "--" ]] && shift # pnpm db:aplicar -- --simular repassa o "--"
case "${1:-}" in
  --simular) SIMULAR=1 ;;
  "") ;;
  *) echo "uso: BANCO_URL=… bash supabase/aplicar-migracoes.sh [--simular]" >&2; exit 2 ;;
esac

falha() { echo "aplicador: ERRO: $*" >&2; exit 1; }
aviso() { echo "aplicador: $*"; }

# Espaço ou quebra de linha colados junto no segredo quebram a URL (incidente de 26/09/2026 com o
# Account ID da Cloudflare); connection string não tem espaço legítimo (senha com espaço vai codificada).
BANCO_URL="$(printf '%s' "${BANCO_URL:-}" | tr -d ' \t\r\n')"
[[ -n "${BANCO_URL:-}" ]] || falha "defina BANCO_URL (a connection string do banco; no Supabase, a do Session pooler)"
[[ ! "$BANCO_URL" =~ (:6543([/?]|$)|[?\&]port=6543(\&|$)) ]] \
  || falha "BANCO_URL aponta para a porta 6543 (transaction pooler), que perde a trava de sessão; use o Session pooler, porta 5432"
command -v psql >/dev/null || falha "psql não encontrado"
command -v node >/dev/null || falha "node não encontrado (a trava de destrutivas é supabase/migracoes/trava.mjs)"
LOCK_TIMEOUT="${MIGRACAO_LOCK_TIMEOUT:-10s}"
STATEMENT_TIMEOUT="${MIGRACAO_STATEMENT_TIMEOUT:-15min}"
[[ "$LOCK_TIMEOUT$STATEMENT_TIMEOUT" =~ ^[0-9a-z]+$ ]] || falha "MIGRACAO_*_TIMEOUT só aceita número e unidade (ex.: 10s, 15min)"
if [[ -z "${COMMIT:-}" ]]; then COMMIT="$(git -C "$RAIZ" rev-parse --verify HEAD 2>/dev/null || echo local)"; fi
[[ "$COMMIT" =~ ^([0-9a-f]{7,40}|local)$ ]] || falha "COMMIT='$COMMIT' não parece um sha do git"
TRAVA_CHAVE=8261720261002 # pg_advisory_lock: uma aplicação por vez neste banco
# Última migration anterior ao aplicador: só ela e as de antes podem ter sido coladas à mão em produção.
# As seguintes nasceram com o aplicador; na primeira execução entram como numa execução normal (uma tabela
# nova ou uma linha de cadastro nova mudaria a impressão digital e travaria a publicação para sempre).
ULTIMA_ANTES_DO_APLICADOR=00000000000000_nenhuma.sql

TMP="$(mktemp -d)"
GUARDA_PID=""
limpar() {
  if [[ -n "$GUARDA_PID" ]]; then kill "$GUARDA_PID" 2>/dev/null || true; wait "$GUARDA_PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap limpar EXIT

export PGAPPNAME="financeiro-aplicador" PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"
sql() { psql "$BANCO_URL" -X -q -At -v ON_ERROR_STOP=1 "$@"; }

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -c1-64; else shasum -a 256 "$1" | cut -c1-64; fi
}

# ---------------------------------------------------------------------------------------------------
# 1. Arquivos do repositório, normalizados: sem BOM e com fim de linha LF. O sha256 é o do texto
#    normalizado — o mesmo no Windows (checkout com CRLF) e no Linux — e é esse texto que vai ao banco.
# ---------------------------------------------------------------------------------------------------
ARQUIVOS=()
declare -A SHA=()
shopt -s nullglob
for caminho in "$MIGRACOES_DIR"/*.sql; do
  nome="$(basename "$caminho")"
  [[ "$nome" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]] || falha "nome fora do padrão AAAAMMDDhhmmss_nome.sql: $nome"
  LC_ALL=C sed $'1s/^\xef\xbb\xbf//; s/\r$//' "$caminho" > "$TMP/$nome"
  ARQUIVOS+=("$nome")
  SHA[$nome]="$(sha256 "$TMP/$nome")"
done
shopt -u nullglob
mapfile -t ARQUIVOS < <(printf '%s\n' "${ARQUIVOS[@]}" | LC_ALL=C sort)
[[ ${#ARQUIVOS[@]} -gt 0 && -n "${ARQUIVOS[0]}" ]] || falha "nenhuma migration em $MIGRACOES_DIR"

# ---------------------------------------------------------------------------------------------------
# 2. Estado do banco
# ---------------------------------------------------------------------------------------------------
PG_MAJOR="$(sql -c "select current_setting('server_version_num')::int / 10000")" \
  || falha "não consegui conectar (confira BANCO_URL; no GitHub Actions use o Session pooler do Supabase)"
TEM_CONTROLE="$(sql -c "select to_regclass('financeiro_admin.migracoes') is not null")"
TABELAS_PUBLIC="$(sql -c "select count(*) from pg_catalog.pg_tables where schemaname = 'public'")"
declare -A APLICADO=()
ULTIMA=""
if [[ "$TEM_CONTROLE" == t ]]; then
  while IFS='|' read -r arquivo sha; do
    [[ -n "$arquivo" ]] || continue
    APLICADO[$arquivo]="$sha"
    ULTIMA="$arquivo"
  done < <(sql -F '|' -c "select arquivo, sha256 from financeiro_admin.migracoes order by arquivo collate \"C\"")
fi
# Até onde reaplicar provando que nenhum dado mudou: gravado na primeira execução num banco que já tinha
# o schema, e lido de volta nas seguintes (se a primeira parar no meio, a regra continua valendo).
MARCO=""
if [[ "$(sql -c "select to_regclass('financeiro_admin.parametros') is not null")" == t ]]; then
  MARCO="$(sql -c "select valor from financeiro_admin.parametros where chave = 'reaplicar_verificando_ate'")"
fi
PRIMEIRA=nao
if [[ ${#APLICADO[@]} -eq 0 && "$TABELAS_PUBLIC" -gt 0 ]]; then
  PRIMEIRA=sim
  [[ -n "$MARCO" ]] || MARCO="${ARQUIVOS[${#ARQUIVOS[@]}-1]}"
fi
if [[ -n "$MARCO" && "$MARCO" > "$ULTIMA_ANTES_DO_APLICADOR" ]]; then MARCO="$ULTIMA_ANTES_DO_APLICADOR"; fi
verificando() { [[ -n "$MARCO" && ! "$1" > "$MARCO" ]]; }

# ---------------------------------------------------------------------------------------------------
# 3. Conferências que param tudo
# ---------------------------------------------------------------------------------------------------
ERROS=()
for arquivo in "${!APLICADO[@]}"; do
  if [[ -z "${SHA[$arquivo]:-}" ]]; then
    ERROS+=("$arquivo foi aplicado e não existe mais no repositório. Migration aplicada não se apaga nem se renomeia: restaure o arquivo.")
  elif [[ "${SHA[$arquivo]}" != "${APLICADO[$arquivo]}" ]]; then
    ERROS+=("$arquivo já foi aplicado e mudou (sha256 no banco ${APLICADO[$arquivo]:0:12}…, no repositório ${SHA[$arquivo]:0:12}…). Migration aplicada nunca se edita: desfaça a edição e faça a mudança num arquivo novo.")
  fi
done
PENDENTES=()
for arquivo in "${ARQUIVOS[@]}"; do
  [[ -n "${APLICADO[$arquivo]:-}" ]] && continue
  if [[ -n "$ULTIMA" && "$arquivo" < "$ULTIMA" ]]; then
    ERROS+=("$arquivo é novo mas tem data anterior à última aplicada ($ULTIMA). Renomeie com a data e hora de agora para ele rodar depois das que já estão no banco.")
  fi
  PENDENTES+=("$arquivo")
done

TRAVA_SAIDA=""
TRAVA_OK=1
if [[ ${#PENDENTES[@]} -gt 0 ]]; then
  caminhos=()
  for arquivo in "${PENDENTES[@]}"; do caminhos+=("$TMP/$arquivo"); done
  # Funções que já existem em public neste banco: chamá-las sem schema também pede aprovação na trava.
  sql -c "select distinct lower(proname) from pg_catalog.pg_proc where pronamespace = 'public'::regnamespace" > "$TMP/funcoes_public.txt"
  set +e
  TRAVA_SAIDA="$(node "$RAIZ/supabase/migracoes/trava.mjs" --funcoes-public "$TMP/funcoes_public.txt" "${caminhos[@]}")"
  estado=$?
  set -e
  case $estado in
    0) ;;
    3) TRAVA_OK=0 ;;
    *) falha "a trava de destrutivas não rodou (saída $estado)" ;;
  esac
fi

if [[ -n "${APLICADOR_SAIDA:-}" ]]; then
  { echo "pendentes=${#PENDENTES[@]}"; echo "primeira_execucao=$PRIMEIRA"; echo "pg_major=$PG_MAJOR"; } >> "$APLICADOR_SAIDA"
fi

aviso "Postgres $PG_MAJOR; ${#APLICADO[@]} migration(s) registrada(s); ${#PENDENTES[@]} pendente(s)."
if [[ "$PRIMEIRA" == sim ]]; then
  aviso "primeira execução do Financeiro: controle vazio; tabelas antigas serão preservadas."
fi
if [[ -n "$MARCO" && "$MARCO" != "$ULTIMA_ANTES_DO_APLICADOR" ]]; then
  aviso "arquivos até $MARCO são reaplicados e só ficam gravados se nenhuma linha de public mudar"
  aviso "(impressão digital dos dados antes e depois, na mesma transação)."
fi
for arquivo in "${PENDENTES[@]}"; do
  modo=""; verificando "$arquivo" && modo=", reaplicação verificando dados"
  aviso "  pendente: $arquivo (sha256 ${SHA[$arquivo]:0:12}…$modo)"
done
[[ -n "$TRAVA_SAIDA" ]] && printf '%s\n' "$TRAVA_SAIDA" | sed 's/^/aplicador: trava: /'
for erro in "${ERROS[@]}"; do echo "aplicador: ERRO: $erro" >&2; done
if [[ ${#ERROS[@]} -gt 0 || $TRAVA_OK -eq 0 ]]; then
  [[ $TRAVA_OK -eq 0 ]] && echo "aplicador: ERRO: a trava recusou arquivo(s) acima. Destrutiva só entra com a linha '-- financeiro:destrutiva-aprovada: <motivo>' e com o fundador sabendo." >&2
  echo "aplicador: nada foi aplicado." >&2
  exit 1
fi
if [[ -n "$SIMULAR" ]]; then
  aviso "simulação: nada foi gravado."
  exit 0
fi
if [[ ${#PENDENTES[@]} -eq 0 ]]; then
  aviso "nada a aplicar."
  exit 0
fi

# ---------------------------------------------------------------------------------------------------
# 4. Aplicar
# ---------------------------------------------------------------------------------------------------
# Trava consultiva de sessão, segura por uma conexão de guarda até o fim do script: outra execução
# simultânea (outro workflow, alguém rodando à mão) para aqui em vez de disputar os mesmos arquivos.
coproc GUARDA { psql "$BANCO_URL" -X -q -At -v ON_ERROR_STOP=1 2>&1; }
{ echo "select pg_try_advisory_lock($TRAVA_CHAVE);" >&"${GUARDA[1]}"; } 2>/dev/null || falha "a conexão de guarda caiu antes de pegar a trava"
resposta=""
read -r -t 30 resposta <&"${GUARDA[0]}" || true
[[ "$resposta" == t ]] || falha "outra aplicação de migrations está em andamento neste banco (trava $TRAVA_CHAVE ocupada) ou a conexão de guarda falhou: '$resposta'. Nada foi aplicado."

sql -1 -f "$RAIZ/supabase/migracoes/controle.sql" >/dev/null
if [[ "$PRIMEIRA" == sim ]]; then
  sql -c "insert into financeiro_admin.parametros (chave, valor) values ('reaplicar_verificando_ate', '$MARCO') on conflict (chave) do nothing" >/dev/null
  MARCO="$(sql -c "select valor from financeiro_admin.parametros where chave = 'reaplicar_verificando_ate'")"
fi

# O que o controle deve conter antes de cada arquivo: o que foi lido no passo 2 mais o que esta execução
# já gravou. Se outra execução gravou algo depois daquela leitura (a guarda caiu, alguém rodou à mão),
# a transação do arquivo percebe antes de rodá-lo e desfaz.
ESPERADO=""
while read -r arquivo; do
  [[ -n "$arquivo" ]] && ESPERADO="${ESPERADO:+$ESPERADO,}$arquivo:${APLICADO[$arquivo]}"
done < <(printf '%s\n' "${!APLICADO[@]}" | LC_ALL=C sort)
for arquivo in "${PENDENTES[@]}"; do
  sha="${SHA[$arquivo]}"
  MODO=aplicada
  if verificando "$arquivo"; then MODO=reaplicada; fi
  cat > "$TMP/antes.sql" <<SQL
set local lock_timeout = '$LOCK_TIMEOUT';
set local statement_timeout = '$STATEMENT_TIMEOUT';
set local client_min_messages = warning;
select set_config('financeiro.controle_esperado', '$ESPERADO', true);
do \$\$ begin
  if (select coalesce(string_agg(arquivo || ':' || sha256, ',' order by arquivo collate "C"), '') from financeiro_admin.migracoes)
     is distinct from current_setting('financeiro.controle_esperado') then
    raise exception 'o controle de migrations mudou durante esta execução (outra aplicação?); nada deste arquivo foi gravado';
  end if;
end \$\$;
SQL
  : > "$TMP/depois.sql"
  if [[ "$MODO" == reaplicada ]]; then
    # A impressão de antes e a de depois têm de ver a MESMA fotografia dos dados: em READ COMMITTED (o
    # padrão) um pedido que o robô do worker grava no meio da reaplicação (cron de 5 min) entraria só na
    # segunda e travaria a publicação acusando "reaplicar mudaria dados". REPEATABLE READ fixa a fotografia
    # no primeiro comando da transação e continua enxergando o que a própria migration muda. Tem de ser a
    # primeira instrução da transação.
    { echo "set transaction isolation level repeatable read;"; cat "$TMP/antes.sql"; } > "$TMP/antes.rr" && mv "$TMP/antes.rr" "$TMP/antes.sql"
    echo "select set_config('financeiro.impressao_antes', financeiro_admin.impressao_dados(), true);" >> "$TMP/antes.sql"
    # Só para o cenário de teste que prova o isolamento (supabase/tests/migracoes/producao.sh): pausa entre
    # as duas impressões para outra sessão gravar no meio. Nunca é definido no GitHub Actions.
    if [[ -n "${APLICADOR_PAUSA_TESTE:-}" ]]; then
      [[ "$APLICADOR_PAUSA_TESTE" =~ ^[0-9]+$ ]] || falha "APLICADOR_PAUSA_TESTE tem de ser um número de segundos"
      echo "select pg_sleep($APLICADOR_PAUSA_TESTE);" >> "$TMP/antes.sql"
      APLICADOR_PAUSA_TESTE="" # uma pausa só, no primeiro arquivo reaplicado
    fi
    cat >> "$TMP/depois.sql" <<'SQL'
do $$ begin
  if financeiro_admin.impressao_dados() is distinct from current_setting('financeiro.impressao_antes', true) then
    raise exception 'reaplicar este arquivo mudaria dados de public: nada dele foi gravado. Ele não é reexecutável sobre o banco de produção (ou o banco difere do repositório); investigue antes de publicar';
  end if;
end $$;
SQL
  fi
  cat >> "$TMP/depois.sql" <<SQL
reset role;
insert into financeiro_admin.migracoes (arquivo, sha256, commit, modo) values ('$arquivo', '$sha', '$COMMIT', '$MODO');
SQL
  aviso "aplicando $arquivo…"
  if ! sql -1 -f "$TMP/antes.sql" -f "$TMP/$arquivo" -f "$TMP/depois.sql" >/dev/null; then
    echo "aplicador: ERRO: $arquivo falhou. A transação dele foi desfeita inteira: nada deste arquivo ficou no banco nem no controle." >&2
    echo "aplicador: as migrations anteriores a ele nesta execução continuam aplicadas e registradas." >&2
    exit 1
  fi
  ESPERADO="${ESPERADO:+$ESPERADO,}$arquivo:$sha"
  aviso "  ok: $arquivo ($MODO)"
done
aviso "pronto: ${#PENDENTES[@]} migration(s) aplicada(s) e registrada(s) em financeiro_admin.migracoes."
