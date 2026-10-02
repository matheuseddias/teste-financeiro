import { useState } from 'react';
import { ArrowRight, Building2, Landmark, LayoutDashboard, TrendingUp, CalendarDays, LogOut, Menu, Moon, ShieldCheck, Sun, Users, X } from 'lucide-react';
import { access } from '@eddias/core';
import { useAuth } from './auth';
import { useStore } from '../domain/store';
import { Notice } from '../ui';
import { Accounts } from '../pages/Accounts';
import { Companies } from '../pages/Companies';
import { Audit, Settings } from '../pages/Settings';
import { Planning } from '../pages/planning/Planning';
import { Commitments } from '../pages/Commitments';
type Page = 'projecoes' | 'lancamentos' | 'inicio' | 'empresas' | 'contas' | 'auditoria' | 'config';
export function App() {
  const { member, session, signOut, config } = useAuth(); const { data, error, refresh } = useStore();
  const [page, setPage] = useState<Page>('inicio'); const [menu, setMenu] = useState(false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('fin-theme') === 'dark'; } catch { return false; } });
  const tabs = [
    { id: 'inicio' as const, label: 'Visão geral', icon: LayoutDashboard, visible: true },
    { id: 'projecoes' as const, label: 'Projeções de caixa', icon: TrendingUp, visible: access(member, 'planejamento') !== 'none' },
    { id: 'lancamentos' as const, label: 'Lançamentos previstos', icon: CalendarDays, visible: access(member, 'planejamento') !== 'none' },
    { id: 'empresas' as const, label: 'Empresas', icon: Building2, visible: access(member, 'empresas') !== 'none' },
    { id: 'contas' as const, label: 'Contas bancárias', icon: Landmark, visible: access(member, 'contas') !== 'none' },
    { id: 'auditoria' as const, label: 'Histórico', icon: ShieldCheck, visible: access(member, 'auditoria') !== 'none' },
    { id: 'config' as const, label: 'Configurações', icon: Users, visible: member.role === 'admin' },
  ].filter(t => t.visible);
  const current = tabs.some(t => t.id === page) ? page : 'inicio';
  function leave() { return !document.querySelector('form[data-dirty="true"]') || window.confirm('Há alterações não salvas. O rascunho ficará neste dispositivo. Continuar?'); }
  function navigate(next: Page) { if (!leave()) return; setPage(next); setMenu(false); }
  return <div className={'app' + (dark ? ' dark' : '')}>
    {menu && <button className="scrim" aria-label="Fechar menu" onClick={() => setMenu(false)} />}
    <aside className={'sidebar' + (menu ? ' open' : '')}><a href="#" className="brand" onClick={e => { e.preventDefault(); navigate('inicio'); }}>eddias<span> financeiro</span></a>
      <div className="workspace"><span className="workspace-icon">E</span><div><strong>{member.workspace_name || 'Grupo Eddias'}</strong><small>Gestão financeira</small></div></div>
      <span className="nav-label">WORKSPACE</span><nav aria-label="Menu principal">{tabs.map(t => <button key={t.id} className={current === t.id ? 'active' : ''} onClick={() => navigate(t.id)}><t.icon size={19} />{t.label}{current === t.id && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="security"><ShieldCheck size={18} /><span>Acesso protegido<br /><small>Permissões por perfil</small></span></div><div className="profile"><span className="avatar">{session.user.email?.slice(0, 1).toUpperCase() || 'E'}</span><div><strong>{session.user.email?.split('@')[0]}</strong><small>{member.role === 'admin' ? 'Administrador' : 'Membro'}</small></div><button className="icon" aria-label="Sair do financeiro" onClick={() => { if (leave()) void signOut(); }}><LogOut size={18} /></button></div></div>
    </aside>
    <div className="main"><header className="topbar"><div className="row"><button className="icon mobile-menu" aria-label={menu ? 'Fechar menu' : 'Abrir menu'} onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button><span>Financeiro <span className="muted">/ {tabs.find(t => t.id === current)?.label}</span></span></div>
      <div className="row">{config.environment === 'preview' && <span className="badge">Ambiente de teste</span>}<button className="icon" aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'} onClick={() => { setDark(!dark); try { localStorage.setItem('fin-theme', dark ? 'light' : 'dark'); } catch { /* Tema disponível sem persistência. */ } }}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button></div></header>
      <main className="content">{error ? <Notice error>{error}<button className="secondary" onClick={() => void refresh().catch(() => {})}>Tentar novamente</button></Notice> : !data ? <p role="status">Carregando cadastros…</p> : <>
        {current === 'inicio' && <><div className="page-heading"><div><p className="eyebrow">SEU FINANCEIRO, ORGANIZADO</p><h1>Visão geral</h1><p>As contas certas, cada empresa no seu lugar.</p></div><span className="badge"><ShieldCheck size={14} />Grupo Eddias</span></div>
          {access(member, 'planejamento') !== 'none' && <section className="card projection-invite"><div><p className="eyebrow">DECISÕES SOBRE O FUTURO</p><h2>Quanto do faturamento vira caixa?</h2><p>Projete o GMV por canal, os repasses, fornecedores e custos. Compare cenários antes de decidir.</p></div><button onClick={() => navigate('projecoes')}>Abrir projeções <ArrowRight size={17} /></button></section>}
          <div className="stats"><div className="card stat"><Building2 size={21} /><span>Empresas cadastradas</span><strong>{data.companies.length}</strong><small>Estrutura do grupo</small></div>
            <div className="card stat"><Landmark size={21} /><span>Contas bancárias</span><strong>{data.accounts.length}</strong><small>Contas correntes e digitais</small></div>
            <div className="card stat"><ShieldCheck size={21} /><span>Com saldo de referência</span><strong>{data.accounts.filter(a => a.reference_date !== null).length}</strong><small>Valores informados no cadastro</small></div></div>
          <section className="card welcome"><div><span className="eyebrow">PRIMEIROS PASSOS</span><h2>Prepare as contas do grupo</h2><p>Cadastre as empresas e vincule cada conta ao seu titular. O saldo de referência precisa ter uma data para orientar o acompanhamento do caixa.</p>
            {access(member, 'empresas') === 'edit' && <button onClick={() => navigate('empresas')}>Organizar empresas <ArrowRight size={17} /></button>}
            {access(member, 'empresas') !== 'edit' && access(member, 'contas') !== 'none' && <button onClick={() => navigate('contas')}>Ver contas <ArrowRight size={17} /></button>}</div>
            <ol><li><span>01</span><div><strong>Identifique as empresas</strong><p>Separe Eddias e Eddias Home conforme a operação.</p></div></li><li><span>02</span><div><strong>Cadastre as contas</strong><p>Inclua bancos e contas digitais, como a Kamino.</p></div></li><li><span>03</span><div><strong>Informe uma referência</strong><p>Registre saldo e data, sem misturar períodos.</p></div></li></ol></section>
          <Notice>Os saldos cadastrados são referências informadas. Não representam valores bancários conciliados.</Notice>
        </>}
        {current === 'projecoes' && <Planning />}{current === 'lancamentos' && <Commitments />}
        {current === 'empresas' && <Companies />}{current === 'contas' && <Accounts />}{current === 'auditoria' && <Audit />}{current === 'config' && member.role === 'admin' && <Settings />}
      </>}<footer>Grupo Eddias <span>Financeiro · {new Date().getFullYear()}</span></footer></main>
    </div></div>;
}
