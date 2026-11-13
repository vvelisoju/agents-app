import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Zap, Trophy, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function Tile({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: LucideIcon; tone: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon size={13} className={tone} /> {label}
      </div>
      <div className="mt-1 text-2xl font-semibold leading-none tabular-nums">{value}</div>
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
        <Tile label="Replies today" value={data.repliesToday ?? 0} icon={MessageCircle} tone="text-primary" />
        <Tile label="Replies total" value={data.repliesTotal ?? 0} icon={Zap} tone="text-accent" />
        <Tile label="Leads won" value={data.leadsByStatus?.won ?? 0} icon={Trophy} tone="text-good" />
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
