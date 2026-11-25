// Inställningar – valuta, kategorier, exempelläge och installation.
(() => {
  const { ui, esc, fmt } = App;
  const CURRENCIES = [
    ['SEK', 'Svenska kronor (SEK)'], ['EUR', 'Euro (EUR)'], ['USD', 'US-dollar (USD)'],
    ['NOK', 'Norska kronor (NOK)'], ['DKK', 'Danska kronor (DKK)'], ['GBP', 'Brittiska pund (GBP)'],
  ];
  const GROUPS = [['needs', 'Behov'], ['wants', 'Nöje'], ['future', 'Framtid & sparande']];
  const opt = (list, sel) => list.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('');
  const FALLBACK_COLOR = '#8a6a55';
  let saved = false;

  function parentOptions(s, selected) {
    return (s.parents || []).map(p => `<option ${p === selected ? 'selected' : ''}>${esc(p)}</option>`).join('');
  }

  // Kategorierna uppdelade per huvudkategori: Inkomster först, sedan i vald ordning
  function parentSections(s, used) {
    const parents = s.parents || [];
    const sections = [[s.incomeLabel || 'Inkomster', s.incomeCategories, true]]
      .concat(parents.map(p => [p, s.categories.filter(c => c.parent === p), false]));
    const rest = s.categories.filter(c => !c.parent || !parents.includes(c.parent));
    if (rest.length) sections.push([App.OTHER_PARENT, rest, false]);
    const removeBtn = c => used.has(c.name) ? '' : `<button class="icon-btn set-remove" data-remove="${esc(c.name)}" aria-label="Ta bort ${esc(c.name)}">${ui.icon('x', 12)}</button>`;
    return sections.map(([title, items, income]) => `
      <h3 class="set-parent">${esc(title)} <span class="muted">${items.length}</span></h3>
      <ul class="set-pills">${items.map(c => income
        ? `<li class="set-pill"><span class="swatch" style="background:var(--dark)"></span>${esc(c.name)}${removeBtn(c)}</li>`
        : `<li class="set-pill">
            <span class="swatch" style="background:${c.color}"></span>${esc(c.name)}
            <select class="set-parent-select" data-cat="${esc(c.name)}" aria-label="Huvudkategori för ${esc(c.name)}">${parentOptions(s, c.parent)}${parents.includes(c.parent) ? '' : `<option selected value="">${App.OTHER_PARENT}</option>`}</select>
            <select class="set-group" data-cat="${esc(c.name)}" aria-label="Grupp för ${esc(c.name)}">${opt(GROUPS, c.group)}</select>
            ${removeBtn(c)}
          </li>`).join('') || '<li class="muted">Inga underkategorier</li>'}</ul>`).join('');
  }

  App.page({
    id: 'installningar',
    title: 'Inställningar',
    overline: 'Inställningar',
    icon: 'cog',

    render(s) {
      const used = new Set(s.transactions.map(t => t.category));

      const foundation = ui.card({
        overline: 'Grundinställningar', title: 'Budgetens grund',
        body: `<p class="muted set-gap">Valutan ändrar bara hur belopp visas. Beloppen räknas inte om.</p>
          <form class="form-stack" id="setForm">
            ${ui.field('Valuta', `<select name="currency">${opt(CURRENCIES, s.settings.currency)}</select>`)}
            ${ui.field('Budgetmånad', `<select name="periodMode">
              <option value="calendar" ${s.settings.period?.mode !== 'payday' ? 'selected' : ''}>Kalendermånad (1:a till sista)</option>
              <option value="payday" ${s.settings.period?.mode === 'payday' ? 'selected' : ''}>Lönemånad (lönedag till dagen före nästa)</option>
            </select>`)}
            ${ui.field('Lönedag', `<input type="number" name="payday" min="1" max="28" value="${esc(s.settings.period?.payday || 25)}">`)}
            <p class="muted">Med lönemånad heter perioden efter månaden den slutar i: november = 25 okt – 24 nov. Infaller lönedagen på en helg börjar perioden fredagen innan.</p>
            ${ui.field('Budgeten börjar', `<input type="date" name="startDate" value="${esc(s.settings.startDate)}">`)}
            <button class="btn btn-primary btn-block" type="submit">Spara inställningar</button>
            ${saved ? '<p class="set-saved" role="status">✓ Sparat</p>' : ''}
          </form>`,
      });

      const categories = ui.card({
        overline: 'Kategorier', title: 'Ditt utgiftssystem',
        body: `${parentSections(s, used)}
          <p class="muted set-gap">Välj huvudkategori för varje underkategori. Gruppen (Behov/Nöje/Framtid) styr 50/30/20-planeringen. Kategorier som används i transaktioner kan inte tas bort.</p>
          <form class="set-add" id="catForm">
            ${ui.field('Kategorinamn', '<input name="name" required maxlength="30" placeholder="t.ex. Husdjur">')}
            ${ui.field('Huvudkategori', `<select name="parent">${parentOptions(s, s.parents[0])}<option value="__income">Inkomster</option></select>`)}
            ${ui.field('Grupp', `<select name="group">${opt(GROUPS, 'needs')}</select>`)}
            <button class="btn btn-secondary" type="submit">${ui.icon('plus', 14)} Egen kategori</button>
          </form>
          <p class="set-error" id="catError" role="alert"></p>
          <div class="set-private">
            <span class="set-private-icon">${ui.icon('lock', 18)}</span>
            <div><b>Privat från början</b><p class="muted">Ingen registrering behövs. Allt sparas på den här enheten.</p></div>
          </div>`,
      });

      const demo = ui.card({
        overline: 'Exempel & test', title: 'Exempelläge',
        body: `<p class="set-text">Exempelläget är skilt från dina egna uppgifter. ${App.mode === 'demo' ? 'Avsluta det för att komma tillbaka till dem.' : 'Prova appen med påhittade siffror utan att röra din egen data.'}</p>
          ${App.mode === 'demo'
            ? '<button class="btn btn-primary" id="setDemo" data-to="personal">Avsluta exempelläge</button>'
            : '<button class="btn btn-secondary" id="setDemo" data-to="demo">Ladda exempeldata</button>'}`,
      });

      const install = ui.card({
        overline: 'Installera', title: 'Använd som app',
        body: `<p class="set-text">På iPhone eller iPad: öppna sidan i Safari, tryck på <b>Dela</b> och välj <b>Lägg till på hemskärmen</b>.</p>
          <p class="set-text">I andra webbläsare: öppna webbläsarens meny och välj <b>Installera app</b>.</p>
          <p class="muted">Installation kräver HTTPS, till exempel din GitHub Pages-adress. Efter installationen fungerar appen även utan internet.</p>`,
      });

      return `<div class="grid-2">${foundation}${categories}</div><div class="grid-2">${demo}${install}</div>`;
    },

    mount(root) {
      saved = false;

      root.querySelector('#setForm').addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.target);
        App.update(s => {
          s.settings.currency = f.get('currency');
          s.settings.period = {
            mode: f.get('periodMode') === 'payday' ? 'payday' : 'calendar',
            payday: Math.min(28, Math.max(1, Number(f.get('payday')) || 25)),
          };
          s.settings.startDate = f.get('startDate') || s.settings.startDate;
        });
        saved = true;
        App.render();
      });

      root.querySelector('#catForm').addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const name = String(f.get('name')).trim();
        const err = root.querySelector('#catError');
        if (!name) return;
        const all = [...App.state.categories, ...App.state.incomeCategories];
        if (all.some(c => c.name.toLowerCase() === name.toLowerCase())) {
          err.textContent = `Kategorin "${name}" finns redan.`;
          return;
        }
        if (f.get('parent') === '__income') {
          App.update(s => { s.incomeCategories.push({ name }); });
          return;
        }
        App.update(s => {
          const usedColors = new Set(s.categories.map(c => c.color));
          const color = App.CATEGORY_COLORS.find(c => !usedColors.has(c)) || FALLBACK_COLOR;
          s.categories.push({ name, group: f.get('group'), parent: f.get('parent'), color });
        });
      });

      root.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => {
        const name = btn.dataset.remove;
        if (!App.confirm(`Ta bort kategorin "${name}"?`)) return;
        App.update(s => {
          s.categories = s.categories.filter(c => c.name !== name);
          s.incomeCategories = s.incomeCategories.filter(c => c.name !== name);
          delete s.defaultBudget[name];
          Object.values(s.budgets).forEach(b => { delete b[name]; });
          if (s.paycheck && s.paycheck.alloc) delete s.paycheck.alloc[name];
        });
      }));

      root.querySelectorAll('.set-group').forEach(sel => sel.addEventListener('change', () => {
        App.update(s => {
          const c = s.categories.find(x => x.name === sel.dataset.cat);
          if (c) c.group = sel.value;
        });
      }));

      root.querySelectorAll('.set-parent-select').forEach(sel => sel.addEventListener('change', () => {
        App.update(s => {
          const c = s.categories.find(x => x.name === sel.dataset.cat);
          if (c) c.parent = sel.value;
        });
      }));

      root.querySelector('#setDemo').addEventListener('click', e => {
        App.setMode(e.currentTarget.dataset.to);
      });
    },
  });
})();
