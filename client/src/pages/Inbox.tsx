import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card } from '@/components/ui/card';
import { MessageCircle, ChevronRight } from 'lucide-react';

function AgentChats({ agent, navigate }: { agent: any; navigate: (to: string) => void }) {
  const { data: convs = [] } = useQuery<any[]>({ queryKey: ['/api/agents/' + agent.id + '/conversations'] });
  if (!convs.length) return null;
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{agent.name}</div>
      {convs.slice(0, 10).map((c) => (
        <Card key={c.id} className="flex cursor-pointer items-center justify-between p-3 hover:bg-muted/40" onClick={() => navigate('/agents/' + agent.id)}>
          <span className="flex items-center gap-2 text-sm">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-muted"><MessageCircle size={14} /></span>
            {c.contactName || c.contactNumber}
          </span>
          <ChevronRight size={16} className="text-muted-foreground" />
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
