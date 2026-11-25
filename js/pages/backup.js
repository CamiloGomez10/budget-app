// Säkerhetskopia – exportera, återställ och rensa data.
(() => {
  const { ui, esc, iso, today, fmt } = App;
  let message = null; // { kind: 'ok' | 'error', text }

  // Godkänner både en exportfil ({ app, data }) och ett rått state-objekt.
  function parseBackup(text) {
    const json = JSON.parse(text);
    const data = json && json.app === 'budget' && json.data ? json.data : json;
    const arrays = ['transactions', 'accounts', 'bills', 'goals', 'debts', 'categories'];
    if (!data || typeof data !== 'object' || data.version !== 2 || !data.settings || arrays.some(k => !Array.isArray(data[k]))) {
      throw new Error('Filen ser inte ut som en säkerhetskopia från den här appen.');
    }
    return data;
  }

  App.page({
    id: 'sakerhetskopia',
    title: 'Säkerhetskopia',
    overline: 'Säkerhetskopia',
    heading: 'Säkerhetskopia & återställning',
    icon: 'backup',

    render(s) {
      const counts = `${s.transactions.length} transaktioner · ${s.accounts.length} konton · ${s.goals.length} mål · ${s.debts.length} skulder · ${s.bills.length} räkningar`;
      const msg = message ? `<p class="bk-msg bk-${message.kind}" role="status">${esc(message.text)}</p>` : '';
      return `
        ${msg}
        <div class="grid-2">
          ${ui.card({
            overline: 'Exportera', title: 'Ladda ner säkerhetskopia',
            body: `<p class="bk-text">Spara all din data som en JSON-fil. Förvara den på ett säkert ställe, till exempel i en privat molnmapp.</p>
              <p class="muted">${counts}${App.mode === 'demo' ? ' · just nu exempeldata' : ''}</p>
              <button class="btn btn-primary btn-block bk-gap" id="bkDownload">${ui.icon('down', 14)} Ladda ner säkerhetskopia (.json)</button>`,
          })}
          ${ui.card({
            overline: 'Återställ', title: 'Återställ från fil',
            body: `<p class="bk-text">Välj en säkerhetskopia som du har laddat ner tidigare.</p>
              ${ui.note('<b>Det här ersätter din nuvarande data.</b>Ladda gärna ner en säkerhetskopia först.')}
              <div class="bk-restore">
                <input type="file" id="bkFile" accept="application/json,.json" aria-label="Välj säkerhetskopia">
                <button class="btn btn-secondary btn-block" id="bkRestore" disabled>Återställ</button>
              </div>`,
          })}
        </div>
        ${ui.card({
          overline: 'Rensa', title: 'Rensa all data',
          body: `<div class="bk-reset">
              <p class="bk-text">Tar bort allt som är sparat i den här webbläsaren: dina egna uppgifter, exempeldata och inställningar. Det går inte att ångra.</p>
              <button class="btn btn-danger bk-danger" id="bkReset">Rensa all data</button>
            </div>`,
        })}`;
    },

    mount(root) {
      message = null;

      root.querySelector('#bkDownload').addEventListener('click', () => {
        const payload = { app: 'budget', exportedAt: new Date().toISOString(), mode: App.mode, data: App.state };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `budget-sakerhetskopia-${iso(today())}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });

      const file = root.querySelector('#bkFile');
      const restore = root.querySelector('#bkRestore');
      file.addEventListener('change', () => { restore.disabled = !file.files.length; });
      restore.addEventListener('click', async () => {
        const f = file.files[0];
        if (!f) return;
        let data;
        try {
          data = parseBackup(await f.text());
        } catch (err) {
          message = { kind: 'error', text: err instanceof SyntaxError ? 'Filen kunde inte läsas som JSON.' : err.message };
          App.render();
          return;
        }
        if (!App.confirm(`Återställa säkerhetskopian med ${data.transactions.length} transaktioner? Din nuvarande data ersätts.`)) return;
        if (App.mode === 'demo') App.setMode('personal');
        App.replaceState(data);
        message = { kind: 'ok', text: `Klart! ${data.transactions.length} transaktioner återställdes.` };
        App.render();
      });

      root.querySelector('#bkReset').addEventListener('click', () => {
        if (!App.confirm('Rensa all data? Allt som är sparat i den här webbläsaren tas bort och det går inte att ångra.')) return;
        App.resetAll();
        message = { kind: 'ok', text: 'All data är rensad.' };
        App.render();
      });
    },
  });
})();
