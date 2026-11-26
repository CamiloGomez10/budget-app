// Molnsynk med Supabase: den personliga datan sparas automatiskt i din egen
// databasrad efter varje ändring. En kopia ligger kvar lokalt så att appen
// fungerar utan internet; ändringarna skickas upp när du är online igen.
// Databasens regler (RLS) gör att bara ditt inloggade konto kan läsa raden.
(() => {
  const SUPABASE_URL = 'https://zbcfcqsigyoqtjkwuqtq.supabase.co';
  // Publik nyckel – får synas i koden. Skyddet sitter i databasens regler.
  const SUPABASE_KEY = 'sb_publishable_ffQZZ49USPnfiQmb6ylN-w_o9a2teqK';
  const TABLE = 'budget_state';
  const META = 'budget-sync';
  const { esc } = App;

  let client = null;
  let user = null;
  let status = 'signedout';
  let timer = null;
  let busy = false;
  let rerun = false;
  let lastError = '';

  const meta = () => { try { return JSON.parse(localStorage.getItem(META)) || {}; } catch (e) { return {}; } };
  const setMeta = patch => { try { localStorage.setItem(META, JSON.stringify({ ...meta(), ...patch })); } catch (e) { /* ignorera */ } };

  const LABELS = {
    unavailable: ['Sparat lokalt', 'Molnsynken kunde inte laddas.'],
    signedout: ['Inte inloggad', 'Logga in så sparas allt automatiskt i molnet.'],
    pending: ['Sparar…', 'Ändringen skickas strax.'],
    syncing: ['Synkar…', 'Pratar med molnet.'],
    synced: ['Synkat', 'Allt är sparat i molnet.'],
    offline: ['Offline', 'Sparat lokalt – skickas när du är online.'],
    error: ['Kunde inte synka', 'Sparat lokalt – försöker igen.'],
  };

  function setStatus(next, err = '') {
    status = next;
    lastError = err;
    const box = document.getElementById('syncBox');
    if (!box) return;
    const [label, text] = LABELS[status] || LABELS.signedout;
    box.dataset.status = status;
    box.querySelector('.local-title').textContent = user ? 'Molnsynk' : 'Lokalt först';
    box.querySelector('.sync-text').textContent = text;
    box.querySelector('.local-status').textContent = `● ${label}`;
    box.querySelector('.sync-btn').textContent = user ? 'Konto' : 'Logga in';
  }

  function schedule() {
    setMeta({ dirty: true });
    if (!user) return;
    setStatus('pending');
    clearTimeout(timer);
    timer = setTimeout(push, 800);
  }

  // Kör en synkoperation i taget; kommer det en till under tiden körs den efteråt.
  async function exclusive(fn) {
    if (busy) { rerun = true; return; }
    busy = true;
    try { await fn(); } finally {
      busy = false;
      if (rerun) { rerun = false; meta().dirty ? push() : pull(); }
    }
  }

  function failed(error) {
    console.warn('Synk:', error);
    setStatus(navigator.onLine ? 'error' : 'offline', error?.message || String(error));
  }

  function push() {
    return exclusive(async () => {
      if (!user) return;
      const data = App.readPersonal();
      if (!data) { setMeta({ dirty: false }); setStatus('synced'); return; }
      setStatus('syncing');
      const updated_at = new Date().toISOString();
      const { error } = await client.from(TABLE).upsert({ user_id: user.id, data, updated_at });
      if (error) return failed(error);
      // Bara klart om inget nytt ändrats medan vi skickade
      if (JSON.stringify(App.readPersonal()) === JSON.stringify(data)) setMeta({ dirty: false, remoteAt: updated_at });
      else rerun = true;
      setStatus('synced');
    });
  }

  function pull() {
    return exclusive(async () => {
      if (!user) return;
      setStatus('syncing');
      const { data: row, error } = await client.from(TABLE).select('data, updated_at').eq('user_id', user.id).maybeSingle();
      if (error) return failed(error);
      const m = meta();
      if (!row) {
        // Inget i molnet ännu: ladda upp det som finns på den här enheten
        if (App.readPersonal()) { rerun = true; setMeta({ dirty: true }); }
        setStatus('synced');
        return;
      }
      const remoteAt = new Date(row.updated_at).toISOString();
      if (m.dirty && m.remoteAt === remoteAt) { rerun = true; return; } // bara lokala ändringar
      if (m.remoteAt !== remoteAt || App.mode !== 'personal') {
        // Molnet har nyare data. Spara undan den lokala datan om den aldrig synkats eller har osynkade ändringar.
        const local = App.readPersonal();
        if (local && (m.dirty || !m.remoteAt)) {
          try { localStorage.setItem('budget-personal-before-sync', JSON.stringify(local)); } catch (e) { /* ignorera */ }
        }
        App.applyRemote(row.data);
      }
      setMeta({ dirty: false, remoteAt });
      setStatus('synced');
    });
  }

  function sync() {
    if (!user) return;
    return meta().dirty ? push() : pull();
  }

  // ---------- Inloggning ----------
  function openDialog() {
    const dlg = document.getElementById('dialog');
    if (user) {
      const [label] = LABELS[status] || LABELS.signedout;
      dlg.innerHTML = `
        <form class="dialog-form" method="dialog">
          <p class="overline">Molnsynk</p>
          <h2 class="card-title" style="margin-bottom:10px">Inloggad</h2>
          <p class="muted">${esc(user.email || '')}</p>
          <p style="margin-top:10px"><b>${esc(label)}</b>${lastError ? ` <span class="muted">– ${esc(lastError)}</span>` : ''}</p>
          <p class="muted" style="margin-top:10px">Alla ändringar sparas automatiskt. En kopia finns också på den här enheten så att appen fungerar offline.</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-secondary" data-act="logout">Logga ut</button>
            <button type="button" class="btn btn-secondary" data-act="sync">Synka nu</button>
            <button type="submit" class="btn btn-primary">Stäng</button>
          </div>
        </form>`;
      dlg.querySelector('[data-act="sync"]').addEventListener('click', () => { sync(); dlg.close(); });
      dlg.querySelector('[data-act="logout"]').addEventListener('click', async () => {
        await client.auth.signOut();
        dlg.close();
      });
    } else {
      dlg.innerHTML = `
        <form class="dialog-form" novalidate>
          <p class="overline">Molnsynk</p>
          <h2 class="card-title" style="margin-bottom:10px">Logga in</h2>
          <p class="muted" style="margin-bottom:14px">När du är inloggad sparas all data automatiskt i molnet och finns på alla dina enheter.</p>
          <div class="form-stack">
            <label class="field"><span class="field-label">E-post</span><input type="email" name="email" autocomplete="email" required></label>
            <label class="field"><span class="field-label">Lösenord</span><input type="password" name="password" autocomplete="current-password" minlength="8" required></label>
            <p class="muted sync-msg" role="status"></p>
          </div>
          <div class="dialog-actions">
            <button type="button" class="btn btn-secondary" data-act="cancel">Avbryt</button>
            <button type="button" class="btn btn-secondary" data-act="signup">Skapa konto</button>
            <button type="submit" class="btn btn-primary">Logga in</button>
          </div>
        </form>`;
      const form = dlg.querySelector('form');
      const msg = dlg.querySelector('.sync-msg');
      const creds = () => ({ email: form.email.value.trim(), password: form.password.value });
      dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => dlg.close());
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        msg.textContent = 'Loggar in…';
        const { error } = await client.auth.signInWithPassword(creds());
        if (error) { msg.textContent = /confirm/i.test(error.message) ? 'Bekräfta först din e-post via länken du fått.' : 'Fel e-post eller lösenord.'; return; }
        dlg.close();
      });
      dlg.querySelector('[data-act="signup"]').addEventListener('click', async () => {
        if (!form.reportValidity()) return;
        msg.textContent = 'Skapar konto…';
        const { data, error } = await client.auth.signUp({ ...creds(), options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) { msg.textContent = `Kunde inte skapa konto: ${error.message}`; return; }
        if (data.session) dlg.close();
        else msg.textContent = 'Klart! Öppna mejlet och klicka på länken, logga sedan in här.';
      });
    }
    dlg.showModal();
  }

  function init() {
    const box = document.getElementById('syncBox');
    if (box) box.querySelector('.sync-btn').addEventListener('click', () => (client ? openDialog() : null));
    App.onChange(schedule);
    if (!window.supabase || !window.supabase.createClient) { setStatus('unavailable'); return; }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((event, session) => {
      const prev = user;
      user = session?.user || null;
      if (!user) { setStatus('signedout'); return; }
      if (!prev || prev.id !== user.id) {
        // Inloggningslänkar lägger token i adressen – städa bort den
        if (/access_token|error_description/.test(location.hash)) history.replaceState(null, '', location.pathname);
        setTimeout(sync, 0);
      }
    });
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
    setInterval(() => { if (document.visibilityState === 'visible' && !busy) sync(); }, 60000);
    setStatus('signedout');
  }

  App.sync = { init, sync, get status() { return status; }, get user() { return user; } };
})();
