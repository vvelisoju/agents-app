// Subscription plans (B10). Prices in INR. maxAgents gates agent creation (402).
export interface Plan { id: string; label: string; maxAgents: number; priceInr: number; }

export const PLANS: Plan[] = [
  { id: 'free', label: 'Free', maxAgents: 10, priceInr: 0 },
  { id: 'growth', label: 'Growth', maxAgents: 50, priceInr: 2499 },
  { id: 'pro', label: 'Pro', maxAgents: 200, priceInr: 4999 },
];

export const getPlan = (id: string) => PLANS.find((p) => p.id === id);
