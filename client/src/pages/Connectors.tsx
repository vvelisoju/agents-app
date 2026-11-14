import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Database, Plus, Trash2, Plug, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';

type Connector = { id: string; name: string; kind: string; active: boolean; _count?: { ops: number } };
type Op = { id: string; name: string; description: string; access: string; sideEffect: string; specJson: string };

// Connector config: the owner adds a DB/REST connection and defines named, parameterized operations
// the agent may call. The agent only picks an operation + fills values — it never writes SQL.
export function Connectors() {
  const { toast } = useToast();
  const { data } = useQuery<{ connectors: Connector[] }>({ queryKey: ['/api/connectors'] });
  const connectors = data?.connectors || [];
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);

  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState('postgres');
  const [secret, setSecret] = React.useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['/api/connectors'] });

  const add = useMutation({
    mutationFn: () => apiRequest('POST', '/api/connectors', { name: name.trim(), kind, secret: secret.trim() }),
    onSuccess: () => { setName(''); setSecret(''); refresh(); toast('Connector added.', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not add connector', 'warn'),
  });
  const del = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/connectors/${id}`),
    onSuccess: () => { setRemoving(null); refresh(); },
    onError: (e: any) => { setRemoving(null); toast(e.message || 'Could not delete', 'warn'); },
  });
  const test = useMutation({
    mutationFn: (id: string) => apiRequest('POST', `/api/connectors/${id}/test`, {}),
    onSuccess: (r: any) => toast(r.ok ? 'Connection OK ✓' : `Failed: ${r.error}`, r.ok ? 'good' : 'warn'),
    onError: (e: any) => toast(e.message || 'Test failed', 'warn'),
  });

  const secretHint = kind === 'rest'
    ? 'JSON config, e.g. {"baseUrl":"https://api.example.com","headers":{"Authorization":"Bearer ..."}}'
    : kind === 'mysql' ? 'mysql://user:pass@host:3306/dbname' : 'postgres://user:pass@host:5432/dbname';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Data connectors</h1>
        <p className="text-sm text-muted-foreground">Connect a database or API and define the exact operations your agents may run. Agents call operations by name — they never write queries themselves.</p>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Plug size={16} className="text-primary" /> Add a connection</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input className="sm:flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Leads DB" />
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="rest">REST API</option>
          </select>
        </div>
        <Input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={secretHint} type="password" />
        <p className="text-[11px] text-muted-foreground">The connection string / keys are encrypted and never shown again.</p>
        <Button disabled={name.trim().length < 2 || secret.trim().length < 5 || add.isPending} onClick={() => add.mutate()}>
          <Plus size={16} /> {add.isPending ? 'Adding…' : 'Add connector'}
        </Button>
      </Card>

      {connectors.map((c) => (
        <Card key={c.id} className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-4">
            <button onClick={() => setOpenId(openId === c.id ? null : c.id)} className="flex min-w-0 items-center gap-3 text-left">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Database size={18} /></span>
              <div className="min-w-0">
                <div className="truncate font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.kind} · {c._count?.ops ?? 0} operation(s)</div>
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button size="sm" variant="ghost" disabled={test.isPending} onClick={() => test.mutate(c.id)}>Test</Button>
              <button onClick={() => setRemoving(c.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 size={15} /></button>
              <ChevronRight size={16} className={cn('text-muted-foreground transition-transform', openId === c.id && 'rotate-90')} />
            </div>
          </div>
          {openId === c.id && <OpsEditor connector={c} />}
        </Card>
      ))}

      <ConfirmDialog
        open={removing !== null}
        title="Delete this connector?"
        message="Its operations are removed and agents can no longer use it."
        confirmLabel="Delete" tone="destructive" busy={del.isPending}
        onConfirm={() => removing && del.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

function OpsEditor({ connector }: { connector: Connector }) {
  const { toast } = useToast();
  const key = ['/api/connectors/' + connector.id + '/ops'];
  const { data } = useQuery<{ ops: Op[] }>({ queryKey: key });
  const ops = data?.ops || [];
  const isRest = connector.kind === 'rest';

  const [opName, setOpName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [access, setAccess] = React.useState('customer');
  const [sideEffect, setSideEffect] = React.useState('read');
  const [sql, setSql] = React.useState('');
  const [method, setMethod] = React.useState('GET');
  const [path, setPath] = React.useState('');
  const [paramNames, setParamNames] = React.useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const resetForm = () => { setOpName(''); setDesc(''); setSql(''); setPath(''); setParamNames(''); };

  const add = useMutation({
    mutationFn: () => {
      const params = paramNames.split(',').map((s) => s.trim()).filter(Boolean).map((n) => ({ name: n, type: 'string' }));
      const spec = isRest ? { method, path: path.trim(), params } : { sql: sql.trim(), params };
      return apiRequest('POST', `/api/connectors/${connector.id}/ops`, { name: opName.trim(), description: desc.trim(), access, sideEffect, spec });
    },
    onSuccess: () => { resetForm(); refresh(); toast('Operation added.', 'good'); },
    onError: (e: any) => toast(e.message || 'Could not add operation', 'warn'),
  });
  const delOp = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/connectors/ops/${id}`),
    onSuccess: refresh,
    onError: (e: any) => toast(e.message || 'Could not delete', 'warn'),
  });

  return (
    <div className="space-y-3 border-t border-border p-4">
      {ops.length > 0 && (
        <ul className="space-y-1.5">
          {ops.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{o.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{o.access} · {o.sideEffect}</span>
                <div className="truncate text-xs text-muted-foreground">{o.description}</div>
              </div>
              <button onClick={() => delOp.mutate(o.id)} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
        <div className="text-xs font-medium text-muted-foreground">Add an operation</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input className="sm:flex-1" value={opName} onChange={(e) => setOpName(e.target.value)} placeholder="operation name, e.g. get_lead_by_phone" />
          <select value={access} onChange={(e) => setAccess(e.target.value)} className="rounded-lg border border-border bg-background px-2 text-xs">
            <option value="customer">customer</option><option value="admin">admin</option>
          </select>
          <select value={sideEffect} onChange={(e) => setSideEffect(e.target.value)} className="rounded-lg border border-border bg-background px-2 text-xs">
            <option value="read">read</option><option value="write">write (needs approval)</option>
          </select>
        </div>
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What it does (shown to the agent)" />
        {isRest ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="rounded-lg border border-border bg-background px-2 text-sm">
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
            </select>
            <Input className="sm:flex-1" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/orders/{id}" />
          </div>
        ) : (
          <Textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={2} placeholder="SELECT name, status FROM leads WHERE phone = $1" />
        )}
        <Input value={paramNames} onChange={(e) => setParamNames(e.target.value)} placeholder="param names in order, e.g. phone (or id, status)" />
        <p className="text-[11px] text-muted-foreground">{isRest ? 'Use {name} in the path; other params become the JSON body.' : 'Use $1, $2… (Postgres) or ? (MySQL) in order of the param names.'}</p>
        <Button size="sm" disabled={opName.trim().length < 2 || add.isPending} onClick={() => add.mutate()}>
          <Plus size={14} /> {add.isPending ? 'Adding…' : 'Add operation'}
        </Button>
      </div>
    </div>
  );
}
