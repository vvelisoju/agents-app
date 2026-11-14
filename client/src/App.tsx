import { Route, Switch, Redirect } from 'wouter';
import { useAuth } from '@/context/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import { Brand } from '@/components/Brand';
import { Login } from '@/pages/Login';
import { Signup } from '@/pages/Signup';
import { Forgot } from '@/pages/Forgot';
import { Agents } from '@/pages/Agents';
import { AgentDetail } from '@/pages/AgentDetail';
import { Inbox } from '@/pages/Inbox';
import { Automations } from '@/pages/Automations';
import { Approvals } from '@/pages/Approvals';
import { Insights } from '@/pages/Insights';
import { Connectors } from '@/pages/Connectors';
import { Audit } from '@/pages/Audit';
import { Leads } from '@/pages/Leads';
import { Settings } from '@/pages/Settings';
import { Subscription } from '@/pages/Subscription';

export function App() {
  const { authed, loading } = useAuth();

  if (loading) {
    return <div className="grid min-h-[100dvh] place-items-center"><Brand size={44} glow className="animate-pulse" /></div>;
  }

  if (!authed) {
    return (
      <Switch>
        <Route path="/signup" component={Signup} />
        <Route path="/forgot" component={Forgot} />
        <Route component={Login} />
      </Switch>
    );
  }

  return (
    <AppShell>
      <Switch>
        <Route path="/agents/:id">{(p) => <AgentDetail id={(p as any)?.id || ''} />}</Route>
        <Route path="/agents" component={Agents} />
        <Route path="/inbox" component={Inbox} />
        <Route path="/automations" component={Automations} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/insights" component={Insights} />
        <Route path="/connectors" component={Connectors} />
        <Route path="/audit" component={Audit} />
        <Route path="/leads" component={Leads} />
        <Route path="/settings" component={Settings} />
        <Route path="/subscription" component={Subscription} />
        <Route path="/"><Redirect to="/agents" /></Route>
        <Route><Redirect to="/agents" /></Route>
      </Switch>
    </AppShell>
  );
}
