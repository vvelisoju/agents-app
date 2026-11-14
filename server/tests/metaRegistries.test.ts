// PXD-29 — GET /api/_meta/registries introspects the self-registered seams
// (channels, tools, workflow handlers). Importing the builtin tool bundle and a
// handler barrel self-registers them (mirrors server boot); 'test' is hidden.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { register } from '../src/channels/registry';
import '../src/tools/builtin'; // self-registers knowledge.search, crm.*, data.*, etc.
import '../src/workflow/handlers'; // self-registers built-in workflow handlers
import { createOrg, createUser } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

register({ type: 'demo-chan', onboarding: 'none', label: 'Demo', send: async () => {} });

describe('GET /api/_meta/registries', () => {
  it('lists channels, tools (with approval flag), and workflow handlers', async () => {
    const org = await createOrg();
    const { token } = await createUser(org.id, 'owner');

    const r = await request(app).get('/api/_meta/registries').set(auth(token));
    expect(r.status).toBe(200);

    const chanTypes = r.body.channels.map((c: any) => c.type);
    expect(chanTypes).toContain('demo-chan');
    expect(chanTypes).not.toContain('test'); // test adapter hidden

    const names = r.body.tools.map((t: any) => t.name);
    expect(names).toContain('knowledge.search');
    const dataAction = r.body.tools.find((t: any) => t.name === 'data.action');
    expect(dataAction.needsApproval).toBe(true); // write tool → approval
    const search = r.body.tools.find((t: any) => t.name === 'knowledge.search');
    expect(search.needsApproval).toBe(false); // read tool → inline

    expect(Array.isArray(r.body.workflowHandlers)).toBe(true);
    expect(r.body.workflowHandlers.length).toBeGreaterThan(0);
  });

  it('requires auth', async () => {
    expect((await request(app).get('/api/_meta/registries')).status).toBe(401);
  });
});
