// LKD-2 (Wave 2) — draft a reaction to someone's LinkedIn post, in the agent's own voice.
//
// Reuses the SAME model + persona machinery as the reply engine (composeSystemPrompt + askClaude),
// so the drafted comment/caption matches the business's configured tone, facts and restrictions.
// The monitor injects this function, so tests exercise the monitor without calling the model.
import prisma from '../prisma';
import { askClaude } from '../brain';
import { composeSystemPrompt, type Source } from '../training';

export interface DraftedReaction { comment: string; reshareCaption: string }

async function loadTraining(agentId: string): Promise<{ profile: any; sources: Source[] }> {
  const profile = await prisma.trainingProfile.findUnique({ where: { agentId } });
  const rows = await prisma.trainingSource.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } });
  const sources: Source[] = rows.map((r) => ({ id: r.id, type: r.type as any, data: JSON.parse(r.dataJson), enabled: r.enabled }));
  return { profile, sources };
}

const commentPrompt = (postText: string) =>
  `Someone in your professional network just published this LinkedIn post:\n\n"""${postText}"""\n\n` +
  `Write a short, genuine, professional comment (1–2 sentences) to leave on it, in the business's voice. ` +
  `Be specific to the post — no generic praise, no hashtags, no emoji spam. Reply with ONLY the comment text.`;

const resharePrompt = (postText: string) =>
  `Someone in your professional network just published this LinkedIn post:\n\n"""${postText}"""\n\n` +
  `Write a brief caption (1–2 sentences) to accompany resharing this post to your own feed, in the business's voice. ` +
  `Add a reason it's worth reading. Reply with ONLY the caption text.`;

// Draft only what the watch's reaction calls for. 'both' drafts a comment AND a reshare caption.
export async function draftReaction(agentId: string, postText: string, reaction: string): Promise<DraftedReaction> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  const { profile, sources } = await loadTraining(agentId);
  const system = composeSystemPrompt(agent, profile, sources);

  const out: DraftedReaction = { comment: '', reshareCaption: '' };
  const safePost = (postText || '').slice(0, 2000);
  if (reaction === 'comment' || reaction === 'both') {
    out.comment = (await askClaude({ system, prompt: commentPrompt(safePost) })).trim();
  }
  if (reaction === 'reshare' || reaction === 'both') {
    out.reshareCaption = (await askClaude({ system, prompt: resharePrompt(safePost) })).trim();
  }
  return out;
}

export type DraftFn = typeof draftReaction;
