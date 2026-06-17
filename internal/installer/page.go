package installer

// installPage is the self-contained first-run installer UI. It has no framework
// and no external assets (the app has no database yet, so nothing else is up).
// The token comes from the page URL (?token=...) and is sent on each request.
const installPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>BurnerByte first-run setup</title>
<style>
  :root { --bg:#f7f7f8; --card:#fff; --fg:#18181b; --muted:#6b7280; --line:#e4e4e7; --accent:#4f46e5; --ok:#15803d; --err:#b91c1c; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100dvh; background:var(--bg); color:var(--fg);
    font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex; align-items:flex-start; justify-content:center; padding:48px 16px; }
  .card { width:100%; max-width:560px; background:var(--card); border:1px solid var(--line);
    border-radius:14px; padding:28px 28px 24px; box-shadow:0 1px 3px rgba(24,24,27,.06); }
  h1 { font-size:20px; margin:0 0 4px; letter-spacing:-.01em; }
  .sub { color:var(--muted); margin:0 0 22px; font-size:13.5px; }
  label { display:block; font-weight:600; font-size:13px; margin:16px 0 6px; }
  .hint { color:var(--muted); font-weight:400; font-size:12px; margin-left:6px; }
  input { width:100%; padding:9px 11px; border:1px solid var(--line); border-radius:8px;
    font:inherit; font-size:14px; background:#fff; }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:var(--accent); }
  .row { display:flex; gap:8px; }
  .row input { flex:1; }
  button { font:inherit; font-weight:600; border-radius:8px; border:1px solid var(--line);
    background:#fff; color:var(--fg); padding:9px 14px; cursor:pointer; }
  button:hover { background:#f4f4f5; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.primary:hover { filter:brightness(1.06); }
  button.gen { padding:9px 12px; font-size:12.5px; white-space:nowrap; }
  button:disabled { opacity:.55; cursor:default; }
  .actions { display:flex; gap:10px; justify-content:flex-end; margin-top:24px;
    border-top:1px solid var(--line); padding-top:18px; }
  .status { margin-top:16px; font-size:13.5px; min-height:20px; }
  .status.ok { color:var(--ok); }
  .status.err { color:var(--err); }
  code { background:#f4f4f5; padding:1px 5px; border-radius:5px; font-size:12.5px; }
</style>
</head>
<body>
  <main class="card">
    <h1>BurnerByte first-run setup</h1>
    <p class="sub">Connect the database and Redis, set the secrets, and the server will restart configured. These are stored in <code>config.yaml</code>.</p>

    <label for="db">Database URL</label>
    <input id="db" placeholder="postgres://user:pass@host:5432/burnerbyte?sslmode=disable" autocomplete="off" spellcheck="false">

    <label for="redis">Redis URL</label>
    <input id="redis" placeholder="redis://:password@host:6379/0" autocomplete="off" spellcheck="false">

    <label for="jwt">JWT secret <span class="hint">32+ chars, signs sessions</span></label>
    <div class="row">
      <input id="jwt" placeholder="long random string" autocomplete="off" spellcheck="false">
      <button type="button" class="gen" onclick="gen('jwt')">Generate</button>
    </div>

    <label for="enc">Encryption key <span class="hint">optional, 64 hex chars; encrypts stored secrets</span></label>
    <div class="row">
      <input id="enc" placeholder="leave blank to store secrets unencrypted" autocomplete="off" spellcheck="false">
      <button type="button" class="gen" onclick="gen('enc')">Generate</button>
    </div>

    <div class="status" id="status"></div>

    <div class="actions">
      <button type="button" id="testBtn" onclick="run('test')">Test connections</button>
      <button type="button" class="primary" id="doneBtn" onclick="run('complete')">Complete setup</button>
    </div>
  </main>

<script>
  var token = new URLSearchParams(location.search).get('token') || '';
  function $(id){ return document.getElementById(id); }
  function hex(n){ var a=new Uint8Array(n); crypto.getRandomValues(a);
    return Array.from(a).map(function(b){return b.toString(16).padStart(2,'0');}).join(''); }
  function gen(id){ $(id).value = hex(32); }
  function setStatus(msg, cls){ var s=$('status'); s.textContent=msg; s.className='status'+(cls?' '+cls:''); }

  function payload(){ return {
    database_url: $('db').value, redis_url: $('redis').value,
    jwt_secret: $('jwt').value, encryption_key: $('enc').value }; }

  async function run(kind){
    var test=$('testBtn'), done=$('doneBtn');
    test.disabled=true; done.disabled=true;
    setStatus(kind==='complete' ? 'Saving and restarting...' : 'Testing...', '');
    try {
      var res = await fetch('/install/'+kind+'?token='+encodeURIComponent(token), {
        method:'POST', headers:{'Content-Type':'application/json','X-Install-Token':token},
        body: JSON.stringify(payload()) });
      var data = await res.json().catch(function(){ return {success:false,message:'unexpected response'}; });
      if (!res.ok || !data.success){ setStatus(data.message || 'Request failed', 'err'); return; }
      if (kind==='complete'){
        setStatus('Configuration saved. The server is restarting; open the app in a few seconds.', 'ok');
        return; // leave buttons disabled; server is going down to restart
      }
      setStatus(data.message || 'Connections OK', 'ok');
    } catch(e){
      setStatus('Network error: '+e.message, 'err');
    } finally {
      if (kind!=='complete'){ test.disabled=false; done.disabled=false; }
    }
  }
</script>
</body>
</html>`
