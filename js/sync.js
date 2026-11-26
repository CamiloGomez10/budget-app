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
    box.querySelector('.local-title').textContent = 'Molnsynk';
    box.querySelector('.sync-text').textContent = text;
    box.querySelector('.local-status').textContent = `● ${label}`;
    box.querySelector('.sync-btn').textContent = 'Konto';
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
  // Appen visas bara för inloggade. Utloggad (eller medan inloggningen kontrolleras)
  // visas inloggningssidan i stället. Vid utloggning tas budgetdatan bort från enheten.
  const gate = {
    el: null,
    mode: 'login', // login | signup | reset | newpass
    show(mode) {
      if (mode) this.mode = mode;
      document.body.classList.remove('auth-wait');
      document.body.classList.add('auth-out');
      this.render();
    },
    hide() {
      document.body.classList.remove('auth-wait', 'auth-out');
      if (this.el) this.el.innerHTML = '';
    },
    render(message = '', isError = false) {
      if (!this.el) {
        this.el = document.createElement('main');
        this.el.className = 'auth';
        this.el.id = 'auth';
        document.body.appendChild(this.el);
      }
      const m = this.mode;
      const TITLES = { login: 'Logga in', signup: 'Skapa konto', reset: 'Glömt lösenord', newpass: 'Välj nytt lösenord' };
      const INTRO = {
        login: 'Din budget sparas i ditt eget konto och finns på alla dina enheter.',
        signup: 'Skapa ett konto med din e-post. Du får ett mejl för att bekräfta det.',
        reset: 'Skriv din e-post så skickar vi en länk där du väljer ett nytt lösenord.',
        newpass: 'Skriv ditt nya lösenord, minst 8 tecken.',
      };
      const BUTTON = { login: 'Logga in', signup: 'Skapa konto', reset: 'Skicka länk', newpass: 'Spara lösenord' };
      this.el.innerHTML = `
        <section class="auth-card">
          <div class="auth-brand"><span class="brand-mark">B.</span><span class="brand-name">Budget</span></div>
          <h1 class="auth-title">${TITLES[m]}</h1>
          <p class="muted auth-intro">${INTRO[m]}</p>
          ${status === 'unavailable' ? '<p class="auth-msg auth-error">Inloggningen kunde inte laddas. Kontrollera internetanslutningen och ladda om sidan.</p>' : ''}
          <form class="form-stack" novalidate>
            ${m !== 'newpass' ? '<label class="field"><span class="field-label">E-post</span><input type="email" name="email" autocomplete="email" required></label>' : ''}
            ${m !== 'reset' ? `<label class="field"><span class="field-label">${m === 'newpass' ? 'Nytt lösenord' : 'Lösenord'}</span><input type="password" name="password" minlength="8" required autocomplete="${m === 'login' ? 'current-password' : 'new-password'}"></label>` : ''}
            <p class="auth-msg ${isError ? 'auth-error' : ''}" role="status">${esc(message)}</p>
            <button class="btn btn-primary btn-block auth-submit" type="submit">${BUTTON[m]}</button>
          </form>
          <div class="auth-links">
            ${m === 'login' ? '<button type="button" class="link-btn" data-mode="signup">Skapa konto</button><button type="button" class="link-btn" data-mode="reset">Glömt lösenord?</button>' : ''}
            ${m === 'signup' || m === 'reset' ? '<button type="button" class="link-btn" data-mode="login">Tillbaka till inloggning</button>' : ''}
          </div>
        </section>`;
      const form = this.el.querySelector('form');
      this.el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { this.mode = b.dataset.mode; this.render(); }));
      form.addEventListener('submit', e => { e.preventDefault(); this.submit(form); });
      const first = form.querySelector('input');
      if (first) first.focus();
    },
    async submit(form) {
      if (!client) return;
      if (!form.reportValidity()) return;
      const email = form.email ? form.email.value.trim() : '';
      const password = form.password ? form.password.value : '';
      const btn = form.querySelector('.auth-submit');
      btn.disabled = true;
      const done = (msg, err) => { this.render(msg, err); if (email && this.el.querySelector('[name=email]')) this.el.querySelector('[name=email]').value = email; };
      if (this.mode === 'login') {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) done(/confirm/i.test(error.message) ? 'Bekräfta först din e-post via länken i mejlet.' : 'Fel e-post eller lösenord.', true);
      } else if (this.mode === 'signup') {
        const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) done(`Kunde inte skapa konto: ${error.message}`, true);
        else if (!data.session) { this.mode = 'login'; done('Klart! Öppna mejlet och klicka på länken. Logga sedan in här.'); }
      } else if (this.mode === 'reset') {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) done(`Kunde inte skicka: ${error.message}`, true);
        else { this.mode = 'login'; done('Om e-posten finns har vi skickat en länk. Öppna den för att välja nytt lösenord.'); }
      } else if (this.mode === 'newpass') {
        const { error } = await client.auth.updateUser({ password });
        if (error) done(`Kunde inte spara: ${error.message}`, true);
        else { this.hide(); App.render(); }
      }
    },
  };

  // Konto-rutan för den som är inloggad
  function openDialog() {
    if (!user) return;
    const dlg = document.getElementById('dialog');
    const [label] = LABELS[status] || LABELS.signedout;
    dlg.innerHTML = `
      <form class="dialog-form" method="dialog">
        <p class="overline">Konto</p>
        <h2 class="card-title" style="margin-bottom:10px">Inloggad</h2>
        <p class="muted">${esc(user.email || '')}</p>
        <p style="margin-top:10px"><b>${esc(label)}</b>${lastError ? ` <span class="muted">– ${esc(lastError)}</span>` : ''}</p>
        <p class="muted" style="margin-top:10px">Alla ändringar sparas automatiskt i ditt konto. Loggar du ut tas budgeten bort från den här enheten, men finns kvar i ditt konto.</p>
        <p class="auth-msg auth-error" role="alert"></p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-act="logout">Logga ut</button>
          <button type="button" class="btn btn-secondary" data-act="sync">Synka nu</button>
          <button type="submit" class="btn btn-primary">Stäng</button>
        </div>
      </form>`;
    dlg.querySelector('[data-act="sync"]').addEventListener('click', () => { sync(); dlg.close(); });
    dlg.querySelector('[data-act="logout"]').addEventListener('click', async e => {
      e.target.disabled = true;
      // Skicka upp osparade ändringar först, så att inget försvinner
      if (meta().dirty) { clearTimeout(timer); await push(); }
      if (meta().dirty) {
        dlg.close();
        if (!await App.confirm('Några ändringar har inte hunnit sparas i ditt konto (ingen internetanslutning?). Loggar du ut nu försvinner de. Logga ut ändå?', { ok: 'Logga ut', danger: true })) return;
      }
      await logout();
      if (dlg.open) dlg.close();
    });
    dlg.showModal();
  }

  async function logout() {
    loggingOut = true;
    try { await client.auth.signOut(); } catch (e) { console.warn(e); }
    user = null;
    App.clearLocal();
    loggingOut = false;
    gate.show('login');
  }
  let loggingOut = false;

  function init() {
    const box = document.getElementById('syncBox');
    if (box) box.querySelector('.sync-btn').addEventListener('click', () => openDialog());
    App.onChange(schedule);
    if (!window.supabase || !window.supabase.createClient) {
      // Inloggningen gick inte att ladda: visa ändå appen med det som finns på enheten
      setStatus('unavailable');
      if (App.readPersonal()) gate.hide(); else gate.show('login');
      return;
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    client.auth.onAuthStateChange((event, session) => {
      const prev = user;
      user = session?.user || null;
      if (!user) {
        setStatus('signedout');
        if (!loggingOut) gate.show();
        return;
      }
      const changed = !prev || prev.id !== user.id;
      if (changed) {
        // Inloggningslänkar lägger token i adressen – städa bort den
        if (/access_token|error_description|type=recovery/.test(location.hash)) history.replaceState(null, '', location.pathname);
        // Datan på enheten tillhör ett annat konto: ta bort den innan den nya hämtas
        if (meta().userId && meta().userId !== user.id) App.clearLocal();
        setMeta({ userId: user.id });
        setTimeout(sync, 0);
      }
      // Länken i "glömt lösenord"-mejlet: välj ett nytt lösenord först
      if (event === 'PASSWORD_RECOVERY') gate.show('newpass');
      else if (changed && gate.mode !== 'newpass') { gate.hide(); App.render(); }
    });
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
    setInterval(() => { if (document.visibilityState === 'visible' && !busy) sync(); }, 60000);
    setStatus('signedout');
  }

  App.sync = { init, sync, get status() { return status; }, get user() { return user; } };
})();
