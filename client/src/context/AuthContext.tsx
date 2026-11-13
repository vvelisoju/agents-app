import * as React from 'react';
import { apiRequest, getToken, setToken } from '@/lib/api';
import { mobileFromEmail, formatMobile } from '@/lib/auth';

interface AuthState {
  email: string | null;
  account: string; // display form (formatted mobile number)
  loading: boolean;
  authed: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  setSession: (token: string, email: string) => void;
  logout: () => void;
}

const Ctx = React.createContext<AuthState>({} as AuthState);
export const useAuth = () => React.useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [email, setEmail] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const loadMe = React.useCallback(async () => {
    if (!getToken()) { setEmail(null); setLoading(false); return; }
    try {
      const me = await apiRequest('GET', '/api/me');
      setEmail(me.email);
    } catch { setToken(''); setEmail(null); }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadMe();
    const onLogout = () => setEmail(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [loadMe]);

  async function auth(path: string, e: string, p: string) {
    const r = await apiRequest('POST', path, { email: e, password: p });
    setToken(r.token);
    setEmail(r.email);
  }

  const value: AuthState = {
    email,
    account: formatMobile(mobileFromEmail(email)) || (email || ''),
    loading,
    authed: !!email,
    login: (e, p) => auth('/api/auth/login', e, p),
    signup: (e, p) => auth('/api/auth/signup', e, p),
    setSession: (t, e) => { setToken(t); setEmail(e); },
    logout: () => { setToken(''); setEmail(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
