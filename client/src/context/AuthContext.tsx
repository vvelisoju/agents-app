import * as React from 'react';
import { apiRequest, getToken, setToken } from '@/lib/api';
import { formatMobile } from '@/lib/auth';

interface AuthState {
  phone: string | null;
  account: string; // display form (formatted mobile number)
  loading: boolean;
  authed: boolean;
  login: (phone: string, password: string) => Promise<void>;
  setSession: (token: string, phone: string) => void;
  logout: () => void;
}

const Ctx = React.createContext<AuthState>({} as AuthState);
export const useAuth = () => React.useContext(Ctx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [phone, setPhone] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const loadMe = React.useCallback(async () => {
    if (!getToken()) { setPhone(null); setLoading(false); return; }
    try {
      const me = await apiRequest('GET', '/api/me');
      setPhone(me.phone);
    } catch { setToken(''); setPhone(null); }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    loadMe();
    const onLogout = () => setPhone(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [loadMe]);

  const value: AuthState = {
    phone,
    account: formatMobile(phone || ''),
    loading,
    authed: !!phone,
    login: async (p, pw) => {
      const r = await apiRequest('POST', '/api/auth/login', { phone: p, password: pw });
      setToken(r.token);
      setPhone(r.phone);
    },
    setSession: (t, p) => { setToken(t); setPhone(p); },
    logout: () => { setToken(''); setPhone(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
