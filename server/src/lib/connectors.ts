// Execute OWNER-DEFINED connector operations with model-supplied parameter VALUES only. The SQL /
// endpoint is written by the owner (as a ConnectorOp); the model never supplies SQL, so there is no
// injection surface and the model can only reach data the owner explicitly exposed. Reads run
// inline; writes are approval-gated by the tool layer. Drivers are lazy-required so pg/mysql2 only
// load when a connector actually runs.
import prisma from './prisma';
import { decryptSecret } from './crypto';
import { log } from './log';

const ROW_CAP = 100;
const TIMEOUT_MS = Number(process.env.CONNECTOR_TIMEOUT_MS) || 10_000;

export interface OpParam { name: string; type?: 'string' | 'number' | 'boolean'; required?: boolean }
export interface OpResult { ok: boolean; rows?: unknown[]; data?: unknown; status?: number; error?: string }

function coerce(v: unknown, type?: string): unknown {
  if (v === undefined || v === null) return null;
  if (type === 'number') return Number(v);
  if (type === 'boolean') return typeof v === 'boolean' ? v : /^(true|1|yes)$/i.test(String(v));
  return String(v);
}

// Bind params in the declared order ($1=params[0], …) — never string-interpolated into the SQL.
function orderedValues(specParams: OpParam[] | undefined, params: Record<string, unknown>): unknown[] {
  return (specParams || []).map((p) => coerce(params[p.name], p.type));
}

async function runPg(url: string, sql: string, values: unknown[]): Promise<OpResult> {
  const { Client } = require('pg');
  const c = new Client({ connectionString: url, statement_timeout: TIMEOUT_MS, query_timeout: TIMEOUT_MS, connectionTimeoutMillis: TIMEOUT_MS });
  await c.connect();
  try {
    const r = await c.query(sql, values);
    return { ok: true, rows: (r.rows || []).slice(0, ROW_CAP) };
  } finally {
    await c.end().catch(() => {});
  }
}

async function runMysql(url: string, sql: string, values: unknown[]): Promise<OpResult> {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection(url);
  try {
    const [rows] = await conn.execute(sql, values);
    return { ok: true, rows: Array.isArray(rows) ? rows.slice(0, ROW_CAP) : [rows] };
  } finally {
    await conn.end().catch(() => {});
  }
}

async function runRest(secretJson: string, spec: any, params: Record<string, unknown>): Promise<OpResult> {
  const cfg = JSON.parse(secretJson || '{}'); // { baseUrl, headers? }
  let path = String(spec.path || '');
  // Path params are URL-encoded so a value can never alter the URL structure.
  for (const p of (spec.params || []) as OpParam[]) {
    path = path.split(`{${p.name}}`).join(encodeURIComponent(String(params[p.name] ?? '')));
  }
  const base = String(cfg.baseUrl || '').replace(/\/$/, '');
  const method = String(spec.method || 'GET').toUpperCase();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const bodyParams = (spec.bodyParams || []) as OpParam[];
    const body = method !== 'GET' && bodyParams.length
      ? JSON.stringify(Object.fromEntries(bodyParams.map((p) => [p.name, coerce(params[p.name], p.type)])))
      : undefined;
    const res = await fetch(base + path, {
      method,
      headers: { ...(cfg.headers || {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function runConnectorOp(connector: any, op: any, params: Record<string, unknown>): Promise<OpResult> {
  const spec = JSON.parse(op.specJson || '{}');
  const secret = decryptSecret(connector.secretEnc);
  try {
    if (connector.kind === 'postgres') return await runPg(secret, spec.sql, orderedValues(spec.params, params));
    if (connector.kind === 'mysql') return await runMysql(secret, spec.sql, orderedValues(spec.params, params));
    if (connector.kind === 'rest') return await runRest(secret, spec, params);
    return { ok: false, error: `unknown connector kind: ${connector.kind}` };
  } catch (e: any) {
    log.warn('connector op failed', { op: op.name, kind: connector.kind, error: String(e?.message || e) });
    return { ok: false, error: 'the data source could not be reached or the query failed' };
  }
}

// Validate a connection before the owner wires operations onto it: a trivial probe (SELECT 1 for
// DB; a base-URL sanity check for REST). Never returns the secret or a raw driver error.
export async function testConnector(connector: any): Promise<{ ok: boolean; error?: string }> {
  const secret = decryptSecret(connector.secretEnc);
  try {
    if (connector.kind === 'postgres') { await runPg(secret, 'SELECT 1', []); return { ok: true }; }
    if (connector.kind === 'mysql') { await runMysql(secret, 'SELECT 1', []); return { ok: true }; }
    if (connector.kind === 'rest') {
      const cfg = JSON.parse(secret || '{}');
      if (!cfg.baseUrl || !/^https?:\/\//i.test(String(cfg.baseUrl))) return { ok: false, error: 'baseUrl must be an http(s) URL' };
      return { ok: true };
    }
    return { ok: false, error: `unknown connector kind: ${connector.kind}` };
  } catch (e: any) {
    log.warn('connector test failed', { kind: connector.kind, error: String(e?.message || e) });
    return { ok: false, error: 'could not connect — check the connection string and that the host is reachable' };
  }
}

// Operations an agent may invoke, filtered by its access level (customer sees customer ops; an
// admin agent sees both) and side-effect (read vs write tool).
export async function opsForAgent(orgId: string, access: string, sideEffect: 'read' | 'write') {
  const levels = access === 'admin' ? ['customer', 'admin'] : ['customer'];
  return prisma.connectorOp.findMany({ where: { orgId, access: { in: levels }, sideEffect } });
}

// A compact listing of available operations for the agentic system prompt, so the model knows what
// it can call and with which params.
export function describeOps(readOps: any[], writeOps: any[]): string {
  const line = (o: any) => {
    const spec = (() => { try { return JSON.parse(o.specJson); } catch { return {}; } })();
    const ps = [...(spec.params || []), ...(spec.bodyParams || [])].map((p: OpParam) => p.name).join(', ');
    return `- ${o.name}(${ps}) — ${o.description}`;
  };
  const parts: string[] = [];
  if (readOps.length) parts.push(`Look up live data with the data.query tool. Operations:\n${readOps.map(line).join('\n')}`);
  if (writeOps.length) parts.push(`Change data with the data.action tool (needs owner approval). Operations:\n${writeOps.map(line).join('\n')}`);
  return parts.join('\n\n');
}
