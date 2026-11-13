import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { channelMeta } from '@/config/channels';
import { ChevronRight } from 'lucide-react';

function AgentChats({ agent, navigate }: { agent: any; navigate: (to: string) => void }) {
  const { data: convs = [] } = useQuery<any[]>({ queryKey: ['/api/agents/' + agent.id + '/conversations'] });
  const m = channelMeta(agent.channelType);
  const Icon = m.icon;
  if (!convs.length) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{agent.name}</div>
      {convs.slice(0, 10).map((c) => (
        <Card key={c.id} className="flex cursor-pointer items-center justify-between p-3 hover:bg-muted/40" onClick={() => navigate('/agents/' + agent.id)}>
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', m.badge)}><Icon size={14} /></span>
            <span className="truncate">{c.contactName || c.contactNumber}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
        </Card>
      ))}
    </div>
  );
}

export function Inbox() {
  const [, navigate] = useLocation();
  const { data: agents = [] } = useQuery<any[]>({ queryKey: ['/api/agents'] });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">Chats from all your agents appear here.</p>
      </div>
      {agents.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">Add an agent to start receiving customer chats.</Card>
      )}
      {agents.map((a) => <AgentChats key={a.id} agent={a} navigate={navigate} />)}
    </div>
  );
}
