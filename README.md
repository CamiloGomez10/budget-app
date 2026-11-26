# Budget

Personlig budgetapp i HTML, CSS och JavaScript. Data sparas lokalt i webbläsaren.

## AI-assistent

Knappen **Fråga** nere till höger öppnar en assistent som kan söka bland
transaktioner, räkna på budgeten och lägga in, ändra eller ta bort transaktioner.
Allt som ändrar något måste godkännas i appen först.

Assistenten använder Claude via ett eget API-konto hos Anthropic (inte ett
claude.ai-abonnemang). Du betalar per fråga från ditt eget saldo. API-nyckeln
ligger hemligt i Supabase, aldrig i appen.

### Installera (en gång)

1. **API-nyckel:** skapa ett konto på console.anthropic.com, fyll på saldo och
   skapa en API-nyckel. Sätt gärna ett utgiftstak per månad.
2. **Funktionen:** i Supabase, gå till *Edge Functions → Deploy a new function →
   Via Editor*. Döp den till `assistent`, klistra in innehållet i
   `supabase/functions/assistent/index.ts` och tryck *Deploy*.
3. **Hemligheter:** under *Edge Functions → Secrets*, lägg till
   - `ANTHROPIC_API_KEY` = nyckeln från steg 1
   - `ALLOWED_EMAILS` = e-posten du loggar in i appen med
4. Logga in i appen och tryck **Fråga**.
