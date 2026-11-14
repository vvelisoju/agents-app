// LKD-1 (Wave 1) — standalone LinkedIn worker entrypoint.
//
// Run this on the OWNER'S OWN always-on machine (NOT on Railway — see docs/LINKEDIN_AGENT_PLAN.md
// §5), pointed at the same DATABASE_URL as the API:
//
//   LINKEDIN_ENABLED=1 npm run linkedin:worker
//
// It drives the real logged-in browser to execute approved LinkedIn actions. The API process does
// NOT run this loop; keeping the browser automation in a separate, owner-hosted process is the
// whole point of the chosen architecture.
require('dotenv').config();
import { runWorker } from './lib/linkedin/worker';
import { realDriver } from './lib/linkedin/driver';
import { draftReaction } from './lib/linkedin/draft';

process.on('unhandledRejection', (reason: any) => console.error('[linkedin-worker] unhandledRejection:', reason?.message || reason));

// The real driver is the write-driver (post/comment/reshare), the reader (fetch latest post), and
// the job searcher; draftReaction calls the model to write the comment/caption in the agent's voice.
runWorker(realDriver, { reader: realDriver, draft: draftReaction }, realDriver).catch((e: any) => {
  console.error('[linkedin-worker] fatal:', e?.message || e);
  process.exit(1);
});
