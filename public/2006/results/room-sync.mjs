const $ = id => document.getElementById(id);
const params = new URLSearchParams(window.location.search);
const room = params.get('room');
const requestId = params.get('request');
let linked = false, busy = false;
const validRoom = value => {
  try { const url = new URL(value); return url.origin === value && url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname) && Number(url.port) >= 1024; }
  catch { return false; }
};
const status = text => { $('status').textContent = text; };
async function transfer() {
  if (!linked || busy) return;
  busy = true; $('retry').hidden = true; $('sign-in').hidden = true;
  status('Getting the active night’s closed results…');
  try {
    const response = await fetch('/api/admin/game/results-export?active=1', {cache:'no-store'});
    if (response.status === 401) {
      status('Sign in once to copy results to your local player.');
      $('sign-in').hidden = false; $('password').focus(); return;
    }
    const results = await response.json();
    if (!response.ok) throw new Error(results.error || 'Results could not be loaded.');
    status('Saving ' + results.showTitle + ' on your laptop…');
    window.opener.postMessage({type:'2006-results-snapshot',requestId,results}, room);
  } catch (error) { status(error.message || 'Connection interrupted. Try again.'); $('retry').hidden = false; }
  finally { busy = false; }
}
$('retry').addEventListener('click', transfer);
$('sign-in').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !linked) return;
  busy = true; const button = $('sign-in').querySelector('button'); button.disabled = true;
  try {
    const response = await fetch('/api/auth/admin-login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});
    $('password').value = '';
    if (!response.ok) throw new Error('Sign-in failed. Check the operator password and try again.');
    busy = false; await transfer();
  } catch (error) { status(error.message || 'Sign-in could not be completed. Try again.'); }
  finally { busy = false; button.disabled = false; }
});
if (!window.opener || !validRoom(room) || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId || '')) {
  status('Open this window with Get latest results in the local room player.');
} else {
  window.addEventListener('message', event => {
    if (event.source !== window.opener || event.origin !== room || event.data?.requestId !== requestId || event.data.type !== '2006-results-request' || linked) return;
    linked = true; void transfer();
  });
  window.opener.postMessage({type:'2006-results-ready',requestId}, room);
}
