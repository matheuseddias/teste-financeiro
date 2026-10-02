import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={'notice' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>{children}</div>;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><h3>{title}</h3><p>{children}</p></div>;
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* Não registrar dados financeiros ou sessão. */ }
  render() { return this.state.failed ? <div className="center"><div className="card"><h1>Não foi possível abrir esta tela</h1><p>Recarregue para tentar novamente. Rascunhos salvos continuam neste dispositivo.</p><button onClick={() => location.reload()}>Recarregar</button></div></div> : this.props.children; }
}
export function useDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? { ...initial, ...JSON.parse(raw) } : initial; } catch { return initial; }
  });
  const [dirty, setDirty] = useState(() => { try { return localStorage.getItem(key) !== null; } catch { return false; } }); const [storageError, setStorageError] = useState(false);
  function update(next: T) {
    setValue(next); setDirty(true);
    try { localStorage.setItem(key, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  }
  function clear() { try { localStorage.removeItem(key); } catch { setStorageError(true); } setDirty(false); setValue(initial); }
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return { value, update, clear, dirty, storageError };
}
