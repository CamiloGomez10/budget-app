// Översikt › Denna period – det viktigaste just nu: vad som finns kvar, vad som
// behöver ses över, kommande räkningar och hur målen går. Trender finns i fliken bredvid.
(() => {
  const { fmt, calc, ui, charts, esc, today, period } = App;

  App.page({
    id: 'oversikt',
    group: 'oversikt',
    tab: 'Denna period',
    title: 'Översikt',
    heading: 'Välkommen tillbaka.',
    icon: 'home',

    render(s) {
      const now = today();
      const key = period.current();
      const monthIndex = Number(key.slice(5)) - 1;
      const monthName = fmt.monthName(monthIndex);
      const range = period.range(key);
      const rangeLabel = period.rangeLabel(key);
      const t = calc.monthTotals(key);
      const plannedTotal = calc.plannedTotal(key);
      const remainingShare = t.income > 0 ? t.net / t.income : 0;
      const daysLeft = period.daysLeft(key);
      const avgExp = calc.avgMonthlyExpense();
      const runway = avgExp > 0 ? calc.liquid() / avgExp : null;
      const periodBills = calc.billsInRange(range.start, range.end);
      const onTrack = t.net >= 0 && (plannedTotal === 0 || t.expense <= plannedTotal);

      const hero = `
        <section class="hero" style="${s.settings.heroImage ? `background-image:linear-gradient(90deg,rgba(43,33,28,.55),rgba(43,33,28,.05) 70%),url(${s.settings.heroImage})` : ''}">
          <div class="hero-text">
            <p class="overline">Budget</p>
            <h2>Lite mer ordning.<br>Mycket mer frihet.</h2>
            <p>Ditt nästa kapitel</p>
          </div>
          <label class="btn btn-small hero-btn">Byt foto<input type="file" accept="image/*" id="heroInput" hidden></label>
        </section>`;

      const summary = `
        <div class="dash-summary">
          <div>
            <h2 class="card-title">Dina pengar, tydligt ordnade.</h2>
            <p class="muted">${t.income > 0 ? `${fmt.pct(Math.max(0, remainingShare))} av inkomsten finns kvar.` : 'Lägg till en inkomst för att komma igång.'}</p>
          </div>
          <div class="dash-health">
            <p class="overline">Månadens hälsa</p>
            <p class="serif dash-health-value">${onTrack ? 'I fas' : 'Se över'}</p>
          </div>
        </div>`;

      // Kvar att spendera följer kontosaldot men tar hänsyn till månadens obetalda räkningar
      const sp = calc.spendable(key);
      const stats = `
        <div class="grid-4">
          ${ui.stat({ label: 'Total inkomst', value: fmt.money(t.income), hint: rangeLabel ? `Lönemånad ${rangeLabel}` : `Registrerat i ${monthName}`, variant: 'dark' })}
          ${ui.stat({ label: 'Totala utgifter', value: fmt.money(t.expense), hint: t.income > 0 ? `${fmt.pct(t.expense / t.income)} av inkomsten` : '–' })}
          ${ui.stat({ label: 'Kvar att spendera', value: sp ? fmt.money(sp.left) : '–', hint: sp ? `Saldo ${fmt.money0(sp.balance)} − obetalt ${fmt.money0(sp.owed)}` : 'Lägg till ett lönekonto under Förmögenhet', variant: 'tan' })}
          ${ui.stat({ label: 'Nettoförmögenhet', value: fmt.money(calc.netWorth()), hint: '<a class="link" href="#/formogenhet">Tillgångar − skulder</a>' })}
        </div>`;

      // Saker att se över: räkningar som passerat, kategorier över budget, konton på minus
      const todayISO = App.iso(now);
      const plan = calc.planned(key);
      const spent = calc.byCategory(calc.txInMonth(key));
      const alerts = [
        ...periodBills.filter(b => !b.isPaid && b.date < todayISO).map(b => `<b>${esc(b.name)}</b> skulle betalas ${fmt.date(b.date)} (${fmt.money0(b.amount)}). <a class="link" href="#/rakningar">Till räkningar</a>`),
        ...s.categories.filter(c => (Number(plan[c.name]) || 0) > 0 && (spent[c.name] || 0) > Number(plan[c.name]))
          .map(c => `<b>${esc(c.name)}</b> är ${fmt.money0(spent[c.name] - Number(plan[c.name]))} över budget.`),
        ...calc.accounts().filter(a => a.balance < 0).map(a => `<b>${esc(a.name)}</b> är på minus (${fmt.money0(a.balance)}).`),
      ];
      const alertCard = alerts.length ? ui.card({
        overline: 'Att se över', title: alerts.length === 1 ? '1 sak' : `${alerts.length} saker`,
        body: `<ul class="dash-alerts">${alerts.map(a => `<li><span>${a}</span></li>`).join('')}</ul>`,
      }) : '';

      const strip = ui.strip([
        { label: 'Sparkvot', value: t.income > 0 ? fmt.pct(remainingShare, 1) : '–' },
        { label: 'Utrymme per dag', value: fmt.money(Math.max(0, t.net) / daysLeft), hint: `${daysLeft} dagar kvar` },
        { label: 'Buffert räcker', value: runway == null ? '–' : `${fmt.num(runway, 1)} mån` },
      ]);

      const byCat = calc.byCategory(calc.txInMonth(key));
      const catItems = s.categories.map(c => ({ name: c.name, color: c.color, value: byCat[c.name] || 0 }))
        .concat(Object.keys(byCat).filter(n => !s.categories.some(c => c.name === n)).map(n => ({ name: n, color: '#8b8178', value: byCat[n] })));

      const spending = `
        <div class="grid-2-1">
          ${ui.card({
            overline: rangeLabel ? `Utgifter ${rangeLabel}` : 'Utgifter', title: 'Per kategori',
            body: t.expense > 0
              ? `<div class="donut-wrap"><div id="dashDonut"></div>${charts.donutLegend(catItems)}</div>`
              : ui.empty('Inga utgifter ännu', `Utgifter i ${monthName} visas här.`),
          })}
          ${ui.card({
            overline: 'Budget', title: 'Använd budget',
            body: plannedTotal > 0 ? '<div id="dashBudget" class="center"></div>' : ui.empty('Ingen budget satt', 'Planera månaden under Budget.'),
          })}
        </div>`;

      // Sparmål fylls på, skulder betalas av: båda visas som framsteg mot målet
      const progressRows = [
        ...calc.goals().map(g => ({ name: g.name, share: g.target > 0 ? g.current / g.target : 0, text: `${fmt.money(g.current)} av ${fmt.money(g.target)}`, color: 'var(--dark)' })),
        ...calc.debts().filter(d => d.balance > 0).map(d => {
          const start = Math.max(0, (Number(d.original) || 0) + (Number(d.adjust) || 0));
          return { name: calc.debtLabel(d), share: start > 0 ? d.paid / start : 0, text: `${fmt.money(d.balance)} kvar att betala`, color: 'var(--caramel)' };
        }),
      ];
      const goals = ui.card({
        overline: 'Mål', title: 'Sparmål och skulder',
        right: '<a class="link" href="#/sparande">Alla mål</a>',
        body: progressRows.length
          ? `<ul class="rows goal-rows">${progressRows.map(g => `<li><div style="flex:1;min-width:0">
                  <div class="goal-line"><b>${esc(g.name)}</b><span class="pct">${fmt.pct(g.share)}</span></div>
                  ${ui.progress(g.share, g.color)}
                  <p class="muted">${g.text}</p>
                </div></li>`).join('')}</ul>`
          : ui.empty('Inga mål ännu', 'Skapa ett sparmål eller lägg in en skuld under Mål.'),
      });

      const upcoming = ui.card({
        overline: 'Härnäst', title: 'Kommande räkningar',
        right: '<a class="link" href="#/rakningar">Kalender</a>',
        body: periodBills.length
          ? `<ul class="rows">${periodBills.map(b => {
              const d = App.parseISO(b.date);
              return `<li>
                <span class="date-badge ${b.debtId ? 'date-badge-dark' : ''}"><b>${d.getDate()}</b><small>${fmt.monthShort(d.getMonth())}</small></span>
                <div style="flex:1;min-width:0"><b>${esc(b.name)}</b><p class="muted">${b.debtId ? (b.recurrence === 'once' ? 'Skuld att betala' : 'Månatlig avbetalning') : recurrenceLabel(b.recurrence)}${b.isPaid ? ' · Betald' : ''}</p></div>
                <span class="amount" style="font-size:17px">${fmt.money0(b.amount)}</span>
              </li>`;
            }).join('')}</ul>`
          : ui.empty('Inga räkningar denna period', 'Lägg till räkningar under Räkningar.'),
      });

      return `${hero}${summary}${stats}${strip}${alertCard}<div class="grid-2">${upcoming}${goals}</div>${spending}`;
    },

    mount(root, s) {

      const key = period.current();
      const byCat = calc.byCategory(calc.txInMonth(key));
      const items = s.categories.map(c => ({ name: c.name, color: c.color, value: byCat[c.name] || 0 }))
        .concat(Object.keys(byCat).filter(n => !s.categories.some(c => c.name === n)).map(n => ({ name: n, color: '#8b8178', value: byCat[n] })));
      const t = calc.monthTotals(key);
      charts.donut(root.querySelector('#dashDonut'), { items, center: { label: 'Totalt', value: fmt.money0(t.expense) }, size: 190, label: 'Utgifter per kategori' });

      const planned = calc.plannedTotal(key);
      const share = planned > 0 ? t.expense / planned : 0;
      charts.ring(root.querySelector('#dashBudget'), {
        share, size: 180, color: share > 1 ? 'var(--rose)' : 'var(--dark)',
        center: { value: fmt.pct(share), label: 'Använt', sub: share <= 1 ? `Kvar ${fmt.money0(planned - t.expense)}` : `Över ${fmt.money0(t.expense - planned)}` },
      });      // Byt hero-foto: skalas ner så att det får plats i localStorage
      const input = root.querySelector('#heroInput');
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, 1600 / img.width);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const data = canvas.toDataURL('image/jpeg', 0.8);
          URL.revokeObjectURL(img.src);
          App.update(st => { st.settings.heroImage = data; });
        };
        img.src = URL.createObjectURL(file);
      });
    },
  });

  function recurrenceLabel(r) {
    return { monthly: 'Varje månad', yearly: 'Varje år', once: 'En gång' }[r] || '';
  }
})();
