import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Sparkles, ShieldCheck } from 'lucide-react';

type ToolRow = { name: string; description: string; sideEffect: string; needsApproval: boolean; enabled: boolean };

// TOOL-17 — outcome-named ability picker. Each tool is phrased as what it lets the agent DO,
// not its internal name. Read-only abilities are safe; abilities that act for you spell out the
// approval implication in words. Enabling any ability turns the agent 'agentic'; turning them
// all off reverts it to the plain reply agent (byte-for-byte).
const FRIENDLY: Record<string, { title: string; blurb: string }> = {
  'knowledge.search': { title: 'Look things up in your knowledge', blurb: 'Search your saved facts and FAQs before answering.' },
  'crm.create_lead': { title: 'Save new leads', blurb: 'Record a new contact as a lead.' },
  'crm.update_lead': { title: 'Update lead status & notes', blurb: 'Mark a lead hot, add notes.' },
  'web.fetch_page': { title: 'Read a web page', blurb: 'Open a public link you point it to and read it.' },
  'calendar.book': { title: 'Book appointments', blurb: 'Offer a slot and book it — you confirm each one first.' },
  'channel.send_message': { title: 'Send a message', blurb: 'Message a contact — you approve each send.' },
  'data.query': { title: 'Look up your business data', blurb: 'Run a read operation you configured in Connectors (leads, orders…).' },
  'data.action': { title: 'Update your business data', blurb: 'Run a write operation (update a status, create a record) — you approve each one.' },
};
const friendly = (name: string) => FRIENDLY[name] || { title: name, blurb: '' };

export function AbilitiesPanel({ id }: { id: string }) {
  const { toast } = useToast();
  const key = ['/api/agents/' + id + '/tools'];
  const { data } = useQuery<{ tools: ToolRow[]; executionMode: string }>({ queryKey: key });
  const tools = data?.tools || [];

  const save = useMutation({
    mutationFn: (names: string[]) => apiRequest('PUT', `/api/agents/${id}/tools`, { tools: names }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['/api/agents/' + id] });
      toast(r.executionMode === 'agentic' ? 'Abilities saved — your agent can now take actions.' : 'Abilities off — back to simple replies.', 'good');
    },
    onError: (e: any) => toast(e.message || 'Could not save abilities', 'warn'),
  });

  const toggle = (name: string, on: boolean) => {
    const next = new Set(tools.filter((t) => t.enabled).map((t) => t.name));
    if (on) next.add(name); else next.delete(name);
    save.mutate([...next]);
  };

  // Admin data access: only relevant once a data connector ability is on.
  const dataOn = tools.some((t) => (t.name === 'data.query' || t.name === 'data.action') && t.enabled);
  const { data: agent } = useQuery<any>({ queryKey: ['/api/agents/' + id] });
  const setAccess = useMutation({
    mutationFn: (level: string) => apiRequest('PATCH', `/api/agents/${id}`, { connectorAccess: level }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/agents/' + id] }); toast('Data access level updated.', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not update', 'warn'),
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-4">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Sparkles size={16} /></span>
          <div>
            <div className="text-sm font-semibold">What your agent can do</div>
            <div className="text-xs text-muted-foreground">Off by default — it just replies. Turn on an ability to let it take action.</div>
          </div>
        </div>
      </Card>

      <div className="space-y-2">
        {tools.map((t) => {
          const f = friendly(t.name);
          return (
            <Card key={t.name} className="flex items-start justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">{f.title}</div>
                <div className="text-xs text-muted-foreground">{f.blurb || t.description}</div>
                {t.needsApproval && (
                  <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    <ShieldCheck size={11} /> You approve each action before it happens
                  </div>
                )}
              </div>
              <Switch checked={t.enabled} onCheckedChange={(v) => !save.isPending && toggle(t.name, v)} />
            </Card>
          );
        })}
        {tools.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No abilities available.</p>}
      </div>

      {dataOn && (
        <Card className="flex items-start justify-between gap-3 p-3.5">
          <div className="min-w-0">
            <div className="text-sm font-medium">Admin data access</div>
            <div className="text-xs text-muted-foreground">
              On: this agent can run operations you marked <b>admin</b> (e.g. internal/staff queries). Keep off for customer-facing agents.
            </div>
          </div>
          <Switch
            checked={agent?.connectorAccess === 'admin'}
            onCheckedChange={(v) => !setAccess.isPending && setAccess.mutate(v ? 'admin' : 'customer')}
          />
        </Card>
      )}
    </div>
  );
}
