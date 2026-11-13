/* Secure Agents — Phase 1 skeleton dashboard (vanilla JS). */
let token = localStorage.getItem('token') || '';
let currentAgent = null;
let ws = null;

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hide');
const hide = (id) => $(id).classList.add('hide');

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'request failed');
  return data;
}

// ---------- auth ----------
async function doAuth(kind) {
  $('authErr').textContent = '';
  try {
    const email = $('email').value.trim(), password = $('password').value;
    const data = await api('/auth/' + kind, 'POST', { email, password });
    token = data.token; localStorage.setItem('token', token);
    boot();
  } catch (e) { $('authErr').textContent = e.message; }
}
function logout() { token = ''; localStorage.removeItem('token'); location.reload(); }

// ---------- views ----------
async function boot() {
  if (!token) { hide('agentsView'); hide('agentView'); show('authView'); $('who').innerHTML = ''; return; }
  try {
    const me = await api('/me');
    $('who').innerHTML = `<span class="muted">${me.email}</span> <button class="ghost sm" onclick="logout()">Log out</button>`;
    hide('authView');
    connectWs();
    showAgents();
  } catch { show('authView'); }
}

async function showAgents() {
  hide('agentView'); show('agentsView'); currentAgent = null;
  const agents = await api('/agents');
  $('agentList').innerHTML = agents.length ? '' : '<p class="muted">No agents yet — add one below.</p>';
  for (const a of agents) {
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `<span><b>${a.name}</b> <span class="pill ${a.status}">${a.status}</span></span>
      <button class="ghost sm" onclick="openAgent('${a.id}')">Open</button>`;
    $('agentList').appendChild(el);
  }
}

async function addAgent() {
  const name = $('newAgentName').value.trim(); if (!name) return;
  await api('/agents', 'POST', { name }); $('newAgentName').value = '';
  showAgents();
}

async function openAgent(id) {
  const a = await api('/agents/' + id);
  currentAgent = a;
  hide('agentsView'); show('agentView'); hide('qrbox');
  $('agentName').textContent = a.name;
  setStatus(a.status);
  $('autoSend').checked = !!a.auto_send;
  subscribe(id);
  await loadTraining(); await loadConversations();
}

function setStatus(status) {
  const el = $('agentStatus'); el.textContent = status; el.className = 'pill ' + status;
}

// ---------- connection ----------
async function connectAgent() { await api('/agents/' + currentAgent.id + '/connect', 'POST'); setStatus('connecting'); }
async function disconnectAgent() { await api('/agents/' + currentAgent.id + '/disconnect', 'POST'); hide('qrbox'); setStatus('disconnected'); }
async function toggleAuto() { await api('/agents/' + currentAgent.id, 'PATCH', { auto_send: $('autoSend').checked }); }

// ---------- training ----------
async function loadTraining() {
  $('learnStatus').textContent = ''; $('learnUrl').value = '';
  const t = await api('/agents/' + currentAgent.id + '/training');
  $('trainSummary').textContent = t.summary;
  $('instructions').value = t.profile.instructions || '';
  $('restrictions').value = t.profile.restrictions || '';
  $('tone').value = t.profile.tone || '';
  $('language').value = t.profile.language || '';
  renderSrcInputs();
  const list = $('sourceList'); list.innerHTML = '';
  for (const s of t.sources) {
    const label = s.type === 'fact' ? s.data.content
      : s.type === 'link' ? `${s.data.name}: ${s.data.url}`
      : `Q: ${s.data.question} / A: ${s.data.answer}`;
    const el = document.createElement('div');
    el.className = 'list-item';
    el.innerHTML = `<span><span class="pill">${s.type}</span> ${label}</span>
      <button class="ghost sm" onclick="delSource('${s.id}')">Remove</button>`;
    list.appendChild(el);
  }
  if (!t.sources.length) list.innerHTML = '<p class="muted">No knowledge added yet.</p>';
}

async function saveProfile() {
  await api('/agents/' + currentAgent.id + '/training/profile', 'PUT', {
    instructions: $('instructions').value, restrictions: $('restrictions').value,
    tone: $('tone').value, language: $('language').value,
  });
  await loadTraining();
}

// ---------- train from a link (invisible-UI onboarding) ----------
// One action: paste a link → the agent reads the page and sets ITSELF up
// (instructions + facts + FAQs + links), then shows what changed. Everything
// it learned lands in the editable lists below, so refining is just removing a
// line — no form to fill, no second "save" step (UX_PRINCIPLES §1-§4).
async function learnLink() {
  const url = $('learnUrl').value.trim();
  if (!url) return;
  const btn = $('learnBtn'), status = $('learnStatus');
  btn.disabled = true; btn.classList.add('spin');
  status.textContent = 'Reading your link and setting the agent up…';
  try {
    const r = await api('/agents/' + currentAgent.id + '/training/learn', 'POST', { url });
    const s = r.suggestion;

    // 1) Fill the instruction fields (keep anything already there).
    applyProfileFromLearned(s);
    await api('/agents/' + currentAgent.id + '/training/profile', 'PUT', {
      instructions: $('instructions').value, restrictions: $('restrictions').value,
      tone: $('tone').value, language: $('language').value,
    });

    // 2) Add the knowledge it found as real, editable sources.
    const counts = { fact: 0, faq: 0, link: 0 };
    for (const f of s.facts || []) { await addLearnedSource('fact', { content: f }); counts.fact++; }
    for (const q of s.faqs || []) { await addLearnedSource('faq', { question: q.question, answer: q.answer }); counts.faq++; }
    for (const l of s.links || []) { await addLearnedSource('link', { name: l.name, url: l.url }); counts.link++; }

    await loadTraining(); // refresh the lists; it clears status, we set the result next
    status.textContent = describeLearned(r.source.title, counts);
  } catch (e) {
    status.textContent = e.message;
  } finally {
    btn.disabled = false; btn.classList.remove('spin');
  }
}

function addLearnedSource(type, data) {
  return api('/agents/' + currentAgent.id + '/training/sources', 'POST', { type, data });
}

// Fill empty profile fields; append new instructions rather than overwrite existing.
function applyProfileFromLearned(s) {
  const instr = $('instructions');
  if (s.instructions && !instr.value.includes(s.instructions)) {
    instr.value = instr.value.trim() ? instr.value.trim() + '\n\n' + s.instructions : s.instructions;
  }
  if (s.tone && !$('tone').value.trim()) $('tone').value = s.tone;
  if (s.language && !$('language').value.trim()) $('language').value = s.language;
  $('manualBox').open = true; // reveal what was filled — nothing hidden from the owner
  flash('instructions');
}

// Plain-language "show what changed" (UX_PRINCIPLES §1). Persistent, not a toast.
function describeLearned(title, c) {
  const parts = [];
  if (c.fact) parts.push(c.fact + (c.fact === 1 ? ' fact' : ' facts'));
  if (c.faq) parts.push(c.faq + (c.faq === 1 ? ' FAQ' : ' FAQs'));
  if (c.link) parts.push(c.link + (c.link === 1 ? ' link' : ' links'));
  const from = title ? '“' + title + '”' : 'your link';
  const learned = parts.length ? ' and learned ' + listWords(parts) : '';
  return '✓ Done — your agent read ' + from + learned +
    ', and its instructions are set. Remove anything below that looks off, or paste another link to add more.';
}
function listWords(a) { return a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

function flash(id) {
  const el = $(id); el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
}

function renderSrcInputs() {
  const type = $('srcType').value;
  const box = $('srcInputs');
  if (type === 'fact') box.innerHTML = `<input id="f1" placeholder="e.g. Open desk from ₹3,999/month" style="width:100%" />`;
  else if (type === 'link') box.innerHTML = `<div class="row"><input id="f1" placeholder="Name (e.g. Location)" style="flex:1" /><input id="f2" placeholder="https://..." style="flex:2" /></div>`;
  else box.innerHTML = `<div class="row"><input id="f1" placeholder="Question" style="flex:1" /><input id="f2" placeholder="Answer" style="flex:1" /></div>`;
}

async function addSource() {
  const type = $('srcType').value;
  let data;
  if (type === 'fact') data = { content: $('f1').value.trim() };
  else if (type === 'link') data = { name: $('f1').value.trim(), url: $('f2').value.trim() };
  else data = { question: $('f1').value.trim(), answer: $('f2').value.trim() };
  if (!Object.values(data).every(Boolean)) return;
  await api('/agents/' + currentAgent.id + '/training/sources', 'POST', { type, data });
  await loadTraining();
}
async function delSource(sid) { await api('/agents/' + currentAgent.id + '/training/sources/' + sid, 'DELETE'); await loadTraining(); }

// ---------- test console ----------
async function runTest() {
  const message = $('testMsg').value.trim(); if (!message) return;
  $('testOut').textContent = 'Thinking…'; show('testOut');
  try { const r = await api('/agents/' + currentAgent.id + '/test', 'POST', { message }); $('testOut').textContent = r.draft || '(no reply)'; }
  catch (e) { $('testOut').textContent = 'Error: ' + e.message; }
}

// ---------- conversations ----------
async function loadConversations() {
  const convs = await api('/agents/' + currentAgent.id + '/conversations');
  const list = $('convList');
  if (!convs.length) { list.innerHTML = '<p class="muted">No conversations yet.</p>'; $('msgList').innerHTML = ''; return; }
  list.innerHTML = '';
  for (const c of convs) {
    const el = document.createElement('div'); el.className = 'list-item';
    el.innerHTML = `<span>${c.contact_name || c.contact_number}</span>
      <button class="ghost sm" onclick="openConv('${c.id}')">View</button>`;
    list.appendChild(el);
  }
}
async function openConv(cid) {
  const msgs = await api('/agents/' + currentAgent.id + '/conversations/' + cid + '/messages');
  const box = $('msgList'); box.innerHTML = '<h3>Messages</h3>';
  for (const m of msgs) {
    const who = m.direction === 'inbound' ? 'Customer' : 'Agent';
    const el = document.createElement('div'); el.className = 'list-item';
    let actions = `<span class="pill">${m.status}</span>`;
    if (m.status === 'draft') actions = `<span class="row"><button class="sm" onclick="approve('${m.id}')">Send</button><button class="ghost sm" onclick="skip('${m.id}')">Skip</button></span>`;
    el.innerHTML = `<span><b>${who}:</b> ${m.body}</span>${actions}`;
    box.appendChild(el);
  }
}
async function approve(mid) { await api('/agents/' + currentAgent.id + '/messages/' + mid + '/approve', 'POST'); await loadConversations(); }
async function skip(mid) { await api('/agents/' + currentAgent.id + '/messages/' + mid + '/skip', 'POST'); }

// ---------- websocket ----------
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const { agentId, type, payload } = JSON.parse(ev.data);
    if (!currentAgent || agentId !== currentAgent.id) return;
    if (type === 'qr') { show('qrbox'); $('qrimg').src = payload.dataUrl; }
    else if (type === 'status') { setStatus(payload.status); if (payload.status === 'connected') hide('qrbox'); }
    else if (type === 'message') { loadConversations(); }
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
}
function subscribe(agentId) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ subscribe: agentId })); else setTimeout(() => subscribe(agentId), 300); }

boot();
