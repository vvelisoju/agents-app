/* Secure Agents — embeddable website chat widget.
   Usage: <script src="https://YOUR_SERVER/widget.js" data-agent="AGENT_ID" data-key="WIDGET_KEY"></script> */
(function () {
  var script = document.currentScript;
  var agentId = script && script.getAttribute('data-agent');
  var key = (script && script.getAttribute('data-key')) || '';
  if (!agentId) return;
  var base = new URL(script.src).origin;
  var CID = 'sa_widget_cid_' + agentId;
  var cid;
  try { cid = localStorage.getItem(CID); } catch (e) {}
  if (!cid) { cid = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem(CID, cid); } catch (e) {} }
  var lastAt = null;

  var css = '\
  .sa-btn{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#2563eb;color:#fff;border:0;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);font-size:24px;z-index:2147483000}\
  .sa-panel{position:fixed;bottom:88px;right:20px;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:calc(100vh - 120px);background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.3);display:none;flex-direction:column;overflow:hidden;z-index:2147483000;font-family:system-ui,sans-serif}\
  .sa-panel.open{display:flex}\
  .sa-head{background:#2563eb;color:#fff;padding:12px 14px;font-weight:600;font-size:14px}\
  .sa-body{flex:1;overflow-y:auto;padding:12px;background:#f8fafc}\
  .sa-msg{margin:6px 0;max-width:80%;padding:8px 11px;border-radius:12px;font-size:14px;line-height:1.35;white-space:pre-wrap;word-wrap:break-word}\
  .sa-them{background:#fff;border:1px solid #e2e8f0;color:#0f172a}\
  .sa-me{background:#2563eb;color:#fff;margin-left:auto}\
  .sa-foot{display:flex;gap:6px;padding:10px;border-top:1px solid #e2e8f0;background:#fff}\
  .sa-in{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:14px;outline:none}\
  .sa-send{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:0 14px;cursor:pointer}';
  var style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  var btn = document.createElement('button'); btn.className = 'sa-btn'; btn.innerHTML = '&#128172;'; btn.setAttribute('aria-label', 'Chat with us');
  var panel = document.createElement('div'); panel.className = 'sa-panel';
  panel.innerHTML = '<div class="sa-head">Chat with us</div><div class="sa-body" id="sa-body"></div>\
    <div class="sa-foot"><input class="sa-in" id="sa-in" placeholder="Type a message…"/><button class="sa-send" id="sa-send">Send</button></div>';
  document.body.appendChild(btn); document.body.appendChild(panel);
  var body = panel.querySelector('#sa-body'), input = panel.querySelector('#sa-in'), sendBtn = panel.querySelector('#sa-send');

  function add(text, who) {
    var d = document.createElement('div'); d.className = 'sa-msg ' + (who === 'me' ? 'sa-me' : 'sa-them'); d.textContent = text;
    body.appendChild(d); body.scrollTop = body.scrollHeight;
  }
  btn.onclick = function () {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !body.childElementCount) add('Hi! How can we help you today?', 'them');
  };
  async function send() {
    var text = input.value.trim(); if (!text) return;
    input.value = ''; add(text, 'me');
    try {
      var r = await fetch(base + '/api/public/widget/' + agentId + '/message?key=' + encodeURIComponent(key), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: cid, name: 'Website visitor', text: text }),
      });
      var j = await r.json();
      if (j && j.reply) { add(j.reply, 'them'); lastAt = new Date().toISOString(); }
    } catch (e) {}
  }
  sendBtn.onclick = send;
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });

  async function poll() {
    try {
      var url = base + '/api/public/widget/' + agentId + '/messages?contactId=' + encodeURIComponent(cid) + '&key=' + encodeURIComponent(key) + (lastAt ? '&after=' + encodeURIComponent(lastAt) : '');
      var r = await fetch(url); var j = await r.json();
      (j.messages || []).forEach(function (m) { add(m.body, 'them'); lastAt = m.at; });
    } catch (e) {}
  }
  setInterval(poll, 4000);
})();
