// Inställningar – valuta, lönemånad, kategorier och säkerhetskopia.
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

  // Förklaring av budgetmånaden med användarens egna datum
  function periodHelp() {
    const base = 'Med lönemånad heter perioden efter månaden den slutar i. Infaller lönedagen på en helg eller röd dag (t.ex. julafton eller midsommarafton) börjar perioden bankdagen innan.';
    if (!App.period.isPayday()) return base;
    const cur = App.period.current();
    const keys = [App.addMonths(cur, -1), cur, App.addMonths(cur, 1)];
    const list = keys.map(k => `${k === cur ? '<b>' : ''}${fmt.cap(fmt.monthName(Number(k.slice(5)) - 1))}: ${App.period.rangeLabel(k)}${k === cur ? ' (nu)</b>' : ''}`).join('<br>');
    return `${base}<br><br>Dina perioder:<br>${list}`;
  }

  function parentOptions(s, selected) {
    return (s.parents || []).map(p => `<option ${p === selected ? 'selected' : ''}>${esc(p)}</option>`).join('');
  }
  const GROUP_SHORT = { needs: 'Behov', wants: 'Nöje', future: 'Framtid' };

  // Vart pengarna i en kategori tar vägen: konto, sparmål, skuld (kopplas på respektive sida)
  function links(s, name) {
    const has = x => (x.categories || []).includes(name);
    return [...s.accounts.filter(a => !a.archived && has(a)), ...s.goals.filter(has), ...s.debts.filter(has)].map(x => x.name);
  }

  // Huvudkategorierna: namn, typ, ordning
  function parentRows(s) {
    const parents = s.parents || [];
    return `<ul class="rows set-prows">
      <li>
        <span class="set-pname">${ui.field('Rubrik för inkomster', `<input data-income-label value="${esc(s.incomeLabel || 'Inkomster')}">`)}</span>
        <span class="muted set-ptype-fixed">Inkomster</span>
      </li>
      ${parents.map((p, i) => {
        const count = s.categories.filter(c => c.parent === p).length;
        return `<li>
          <span class="set-pname">${ui.field(`Huvudkategori ${i + 1}`, `<input data-pname="${esc(p)}" value="${esc(p)}">`)}</span>
          ${ui.field('Typ', `<select data-ptype="${esc(p)}">${opt(Object.entries(App.PARENT_TYPES), App.calc.parentType(p))}</select>`, 'set-ptype')}
          <span class="set-pbtns">
            <button class="icon-btn" data-pmove="${esc(p)}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Flytta upp ${esc(p)}">${ui.icon('up', 14)}</button>
            <button class="icon-btn" data-pmove="${esc(p)}" data-dir="1" ${i === parents.length - 1 ? 'disabled' : ''} aria-label="Flytta ner ${esc(p)}">${ui.icon('down', 14)}</button>
            ${count ? '' : `<button class="icon-btn" data-premove="${esc(p)}" aria-label="Ta bort ${esc(p)}">${ui.icon('x', 14)}</button>`}
          </span>
        </li>`;
      }).join('')}
    </ul>`;
  }

  // Kategorierna uppdelade per huvudkategori: Inkomster först, sedan i vald ordning
  function parentSections(s, used) {
    const parents = s.parents || [];
    const sections = [[s.incomeLabel || 'Inkomster', s.incomeCategories, true]]
      .concat(parents.map(p => [p, s.categories.filter(c => c.parent === p), false]));
    const rest = s.categories.filter(c => !c.parent || !parents.includes(c.parent));
    if (rest.length) sections.push([App.OTHER_PARENT, rest, false]);
    const removeBtn = (c, income) => `<button class="icon-btn set-remove" data-remove="${esc(c.name)}" data-income="${income ? 1 : ''}" aria-label="Ta bort ${esc(c.name)}">${ui.icon('x', 12)}</button>`;
    return sections.map(([title, items, income]) => {
      const type = income ? '' : parents.includes(title) ? App.PARENT_TYPES[App.calc.parentType(title)] : '';
      return `
      <h3 class="set-parent">${esc(title)} <span class="muted">${type ? `${type} · ` : ''}${items.length}</span></h3>
      <ul class="set-pills">${items.map(c => {
        const to = income ? [] : links(s, c.name);
        const tags = income ? '' : `<span class="set-tag">${GROUP_SHORT[c.group] || ''}</span>${c.debt ? '<span class="set-tag set-tag-debt">Skuld</span>' : ''}${to.length ? `<span class="set-link">→ ${esc(to.join(' · '))}</span>` : ''}`;
        return `<li class="set-pill">
          <button type="button" class="set-pill-btn" data-cat="${esc(c.name)}" data-income="${income ? 1 : ''}" aria-label="Ändra ${esc(c.name)}">
            <span class="swatch" style="background:${income ? 'var(--dark)' : c.color}"></span>${esc(c.name)}${tags}
          </button>${removeBtn(c, income)}</li>`;
      }).join('') || '<li class="muted">Inga underkategorier</li>'}</ul>`;
    }).join('');
  }

  // Ta bort en kategori. Har den transaktioner flyttas de först till andra kategorier:
  // bocka i en eller flera, välj ny kategori, flytta – tills listan är tom.
  function removeCategory(name, replacement) {
    App.update(s => {
      s.categories = s.categories.filter(c => c.name !== name);
      s.incomeCategories = s.incomeCategories.filter(c => c.name !== name);
      delete s.defaultBudget[name];
      Object.values(s.budgets).forEach(b => { delete b[name]; });
      if (s.paycheck && s.paycheck.alloc) delete s.paycheck.alloc[name];
      [...s.accounts, ...s.goals, ...s.debts].forEach(x => { x.categories = (x.categories || []).filter(c => c !== name); });
      s.bills.forEach(b => { if (b.category === name) b.category = replacement || ''; });
    });
  }

  function openRemoveDialog(name, income) {
    const dlg = document.getElementById('dialog');
    const txOf = () => App.state.transactions
      .filter(t => t.type !== 'transfer' && t.category === name)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (!txOf().length) {
      if (App.confirm(`Ta bort kategorin "${name}"?`)) removeCategory(name);
      return;
    }
    let lastTarget = '';
    const options = () => (income
      ? App.state.incomeCategories.filter(c => c.name !== name).map(c => `<option ${c.name === lastTarget ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
      : ui.categoryOptions(lastTarget));

    const draw = () => {
      const list = txOf();
      if (!list.length) {
        dlg.close();
        removeCategory(name, lastTarget);
        return;
      }
      dlg.innerHTML = `
        <form class="dialog-form set-move" novalidate>
          <p class="overline">Ta bort kategori</p>
          <h2 class="card-title">${esc(name)}</h2>
          <p class="muted set-gap">Kategorin har <b>${list.length}</b> ${list.length === 1 ? 'transaktion' : 'transaktioner'}. Bocka i en eller flera, välj vilken kategori de ska flyttas till och tryck på Flytta. När listan är tom tas kategorin bort.</p>
          <label class="check set-move-all"><input type="checkbox" id="moveAll"> Markera alla</label>
          <ul class="rows set-move-list">${list.map(t => `<li>
            <label class="check"><input type="checkbox" name="tx" value="${esc(t.id)}">
              <span class="set-move-title">${esc(t.title || t.category)}<span class="muted"> · ${App.fmt.date(t.date)}</span></span>
            </label>
            <b>${App.fmt.money(t.amount)}</b>
          </li>`).join('')}</ul>
          <div class="set-move-bar">
            ${ui.field('Flytta till', `<select name="target" required>${options()}</select>`)}
            <button type="submit" class="btn btn-primary" id="moveBtn" disabled>Flytta</button>
          </div>
          <div class="dialog-actions"><button type="button" class="btn btn-secondary" data-cancel>Stäng</button></div>
        </form>`;
      const form = dlg.querySelector('form');
      const boxes = [...form.querySelectorAll('[name=tx]')];
      const btn = form.querySelector('#moveBtn');
      // Kategorin som tas bort kan inte vara mål
      form.querySelectorAll('[name=target] option').forEach(o => { if (o.textContent === name) o.remove(); });
      form.querySelectorAll('[name=target] optgroup').forEach(g => { if (!g.children.length) g.remove(); });
      if (!form.querySelector('[name=target] option')) {
        form.querySelector('.set-move-bar').innerHTML = '<p class="set-error">Det finns ingen annan kategori att flytta till. Skapa en ny kategori först.</p>';
      }
      const sync = () => {
        const n = boxes.filter(b => b.checked).length;
        btn.disabled = !n;
        btn.textContent = n ? `Flytta ${n}` : 'Flytta';
        form.querySelector('#moveAll').checked = n === boxes.length;
      };
      boxes.forEach(b => b.addEventListener('change', sync));
      form.querySelector('#moveAll').addEventListener('change', e => { boxes.forEach(b => { b.checked = e.target.checked; }); sync(); });
      form.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
      form.addEventListener('submit', e => {
        e.preventDefault();
        const ids = new Set(boxes.filter(b => b.checked).map(b => b.value));
        const target = form.querySelector('[name=target]').value;
        if (!ids.size || !target) return;
        lastTarget = target;
        App.update(s => { s.transactions.forEach(t => { if (ids.has(t.id)) t.category = target; }); });
        draw();
      });
    };
    draw();
    if (dlg.open === false) dlg.showModal();
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
            <p class="muted">${periodHelp()}</p>
            <button class="btn btn-primary btn-block" type="submit">Spara inställningar</button>
            ${saved ? '<p class="set-saved" role="status">✓ Sparat</p>' : ''}
          </form>`,
      });

      const parentsCard = ui.card({
        overline: 'Huvudkategorier', title: 'Struktur',
        body: `<p class="muted set-gap">Typen styr hur kategorierna räknas i hela appen: <b>Sparande</b> kan fylla sparkonton och sparmål, <b>Fasta kostnader</b> räknas inte som köp i Köpfri utmaning. Ordningen är den ordning budgeten visas i.</p>
          ${parentRows(s)}
          <form class="set-add set-add-parent" id="parentForm">
            ${ui.field('Ny huvudkategori', '<input name="name" required maxlength="30" placeholder="t.ex. Barn">')}
            ${ui.field('Typ', `<select name="type">${opt(Object.entries(App.PARENT_TYPES), 'variable')}</select>`)}
            <button class="btn btn-secondary" type="submit">${ui.icon('plus', 14)} Lägg till</button>
          </form>
          <p class="set-error" id="parentError" role="alert"></p>`,
      });

      const categories = ui.card({
        overline: 'Kategorier', title: 'Ditt utgiftssystem',
        body: `${parentSections(s, used)}
          <p class="muted set-gap">Tryck på en kategori för att byta namn, huvudkategori eller grupp, eller för att märka den som <b>skuldbetalning</b>. Gruppen (Behov/Nöje/Framtid) styr 50/30/20-planeringen. Pilen visar vart pengarna går (kopplas under Konton, Sparande och Skulder). Tar du bort en kategori som har transaktioner får du först välja vart de ska flyttas.</p>
          <form class="set-add" id="catForm">
            ${ui.field('Kategorinamn', '<input name="name" required maxlength="30" placeholder="t.ex. Husdjur">')}
            ${ui.field('Huvudkategori', `<select name="parent">${parentOptions(s, s.parents[0])}<option value="__income">Inkomster</option></select>`)}
            ${ui.field('Grupp', `<select name="group">${opt(GROUPS, 'needs')}</select>`)}
            <button class="btn btn-secondary" type="submit">${ui.icon('plus', 14)} Egen kategori</button>
          </form>
          <p class="set-error" id="catError" role="alert"></p>
          <div class="set-private">
            <span class="set-private-icon">${ui.icon('lock', 18)}</span>
            <div><b>Privat och sparat</b><p class="muted">När du är inloggad sparas allt automatiskt i ditt eget, skyddade molnkonto – och en kopia finns på enheten.</p></div>
          </div>`,
      });

      const backup = ui.card({
        overline: 'Säkerhetskopia', title: 'Ladda ner din data',
        body: `<p class="set-text">Allt sparas automatiskt, men vill du ha en egen kopia ifall att kan du ladda ner all data som en fil.</p>
          <button class="btn btn-secondary" id="setBackup">${ui.icon('down', 14)} Ladda ner säkerhetskopia</button>`,
      });

      return `<div class="grid-2">${foundation}${parentsCard}</div>${categories}${backup}`;
    },

    mount(root) {
      saved = false;

      root.querySelector('#setBackup').addEventListener('click', () => {
        const payload = { app: 'budget', exportedAt: new Date().toISOString(), mode: App.mode, data: App.state };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `budget-sakerhetskopia-${App.iso(App.today())}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });

      root.querySelector('#setForm').addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.target);
        App.update(s => {
          s.settings.currency = f.get('currency');
          s.settings.period = {
            mode: f.get('periodMode') === 'payday' ? 'payday' : 'calendar',
            payday: Math.min(28, Math.max(1, Number(f.get('payday')) || 25)),
          };
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
        openRemoveDialog(btn.dataset.remove, !!btn.dataset.income);
      }));

      const nameTaken = (name, except) => [...App.state.categories, ...App.state.incomeCategories]
        .some(c => c.name !== except && c.name.toLowerCase() === name.toLowerCase());

      // Ändra en kategori: namn, huvudkategori, grupp, skuldbetalning
      root.querySelectorAll('.set-pill-btn').forEach(btn => btn.addEventListener('click', () => {
        const income = !!btn.dataset.income;
        const name = btn.dataset.cat;
        const s = App.state;
        const c = (income ? s.incomeCategories : s.categories).find(x => x.name === name);
        if (!c) return;
        App.formDialog({
          overline: income ? esc(s.incomeLabel || 'Inkomster') : 'Kategori', title: `Ändra ${esc(name)}`,
          body: `${ui.field('Namn', `<input name="name" required maxlength="30" value="${esc(name)}">`)}
            ${income ? '<p class="muted">Byter du namn uppdateras alla transaktioner och budgetar.</p>' : `
            ${ui.field('Huvudkategori', `<select name="parent">${parentOptions(s, c.parent)}</select>`)}
            ${ui.field('Grupp (50/30/20)', `<select name="group">${opt(GROUPS, c.group)}</select>`)}
            <label class="check"><input type="checkbox" name="debt" ${c.debt ? 'checked' : ''}> Skuldbetalning (t.ex. Klarna, Walley, lån)</label>
            <p class="muted">Skuldbetalningar kan kopplas till en skuld under Skuldavbetalning. Byter du namn uppdateras alla transaktioner, budgetar och kopplingar.</p>`}
            <p class="set-error" id="catEditError" role="alert"></p>`,
          onSubmit(f) {
            const next = String(f.get('name')).trim();
            if (!next) return false;
            if (next !== name && nameTaken(next, name)) {
              document.getElementById('catEditError').textContent = `Kategorin "${next}" finns redan.`;
              return false;
            }
            if (next !== name) App.renameCategory(name, next);
            if (!income) {
              App.update(st => {
                const x = st.categories.find(y => y.name === next);
                x.parent = f.get('parent');
                x.group = f.get('group');
                if (f.get('debt') === 'on') x.debt = true; else delete x.debt;
              });
            }
          },
        });
      }));

      // Huvudkategorier
      root.querySelector('[data-income-label]').addEventListener('change', e => {
        const v = e.target.value.trim();
        if (v) App.update(s => { s.incomeLabel = v; });
      });
      root.querySelectorAll('[data-pname]').forEach(inp => inp.addEventListener('change', () => {
        const old = inp.dataset.pname;
        const v = inp.value.trim();
        if (!v || v === old) { inp.value = old; return; }
        if (App.state.parents.some(p => p.toLowerCase() === v.toLowerCase())) {
          root.querySelector('#parentError').textContent = `Huvudkategorin "${v}" finns redan.`;
          inp.value = old;
          return;
        }
        App.renameParent(old, v);
      }));
      root.querySelectorAll('[data-ptype]').forEach(sel => sel.addEventListener('change', () => {
        App.update(s => { s.parentTypes = { ...(s.parentTypes || {}), [sel.dataset.ptype]: sel.value }; });
      }));
      root.querySelectorAll('[data-pmove]').forEach(btn => btn.addEventListener('click', () => {
        App.update(s => {
          const i = s.parents.indexOf(btn.dataset.pmove);
          const j = i + Number(btn.dataset.dir);
          if (i < 0 || j < 0 || j >= s.parents.length) return;
          [s.parents[i], s.parents[j]] = [s.parents[j], s.parents[i]];
        });
      }));
      root.querySelectorAll('[data-premove]').forEach(btn => btn.addEventListener('click', () => {
        const p = btn.dataset.premove;
        if (!App.confirm(`Ta bort huvudkategorin "${p}"?`)) return;
        App.update(s => { s.parents = s.parents.filter(x => x !== p); if (s.parentTypes) delete s.parentTypes[p]; });
      }));
      root.querySelector('#parentForm').addEventListener('submit', e => {
        e.preventDefault();
        const f = new FormData(e.target);
        const name = String(f.get('name')).trim();
        if (!name) return;
        if (App.state.parents.some(p => p.toLowerCase() === name.toLowerCase()) || name === App.OTHER_PARENT) {
          root.querySelector('#parentError').textContent = `Huvudkategorin "${name}" finns redan.`;
          return;
        }
        App.update(s => { s.parents.push(name); s.parentTypes = { ...(s.parentTypes || {}), [name]: f.get('type') }; });
      });

    },
  });
})();
