# Budget

Personlig budgetapp i HTML, CSS och JavaScript. Data sparas lokalt i webbläsaren.


## Koppla Claude (ingen extra kostnad)

Du kan prata med Claude om din budget direkt i Claude-appen (dator, webb eller
mobil): "hur mycket har jag lagt på mat i november?" eller "lägg in 250 kr på ICA
idag". Det ingår i ditt Claude-abonnemang. Kopplingen loggar in med ditt
budgetkonto, och varje konto ser bara sin egen budget.

### Installera i Supabase (en gång)

1. **Signeringsnyckel:** *Project Settings → JWT Keys*. Om det bara finns en
   "Legacy HS256"-nyckel: skapa en ny nyckel av typen ECC (P-256) och tryck
   *Rotate keys*. (Du kan behöva logga in i appen igen efteråt.)
2. **OAuth-server:** *Authentication → OAuth Server*. Slå på den, slå på
   *Allow dynamic client registration* och sätt *Authorization path* till
   `/oauth.html`.
3. **Adress:** *Authentication → URL Configuration*. *Site URL* ska vara
   `https://camilogomez10.github.io/budget-app`.
4. **Funktionen:** *Edge Functions → Deploy a new function → Via Editor*. Döp den
   till `budget-mcp`, klistra in `supabase/functions/budget-mcp/index.ts` och
   tryck *Deploy*. Öppna sedan funktionens inställningar och stäng av
   *Enforce JWT verification* (kopplingen sköter inloggningen själv).

### Lägg till i Claude (varje person gör det själv)

I Claude: *Inställningar → Kopplingar (Connectors) → Lägg till egen koppling*.
Namn: `Budget`. Adress:

    https://yimveqgkicdyqfchycyw.supabase.co/functions/v1/budget-mcp

Tryck *Anslut*, logga in med ditt budgetkonto och tryck *Godkänn*. Din vän gör
samma sak i sin Claude med sitt eget budgetkonto.

Ändringar som Claude gör syns i appen nästa gång den synkar (när du öppnar den).
