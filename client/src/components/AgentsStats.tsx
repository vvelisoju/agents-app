import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </Card>
  );
}

// "What your agents did" — a glanceable, AI-agentic stat strip + per-agent breakdown.
export function AgentsStats() {
  const { data } = useQuery<any>({ queryKey: ['/api/analytics'] });
  if (!data) return null;
  const perAgent: any[] = Array.isArray(data.perAgent) ? data.perAgent : [];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Replies today" value={data.repliesToday ?? 0} />
        <Tile label="Replies total" value={data.repliesTotal ?? 0} />
        <Tile label="Leads won" value={data.leadsByStatus?.won ?? 0} />
      </div>
      {perAgent.length > 1 && (
        <Card className="divide-y divide-border p-0">
          {perAgent.map((a) => (
            <div key={a.agentId} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="truncate">{a.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{a.conversations} chats · {a.repliesTotal} replies</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
