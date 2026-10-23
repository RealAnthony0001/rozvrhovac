# Rozvrhovač

Společný týdenní rozvrh: každý si označí, kdy je obsazený, aplikace zvýrazní volno všech. Události + měsíční kalendář s "kdo jde".

Frontend je statický (`public/`, bez buildu) a běží na GitHub Pages. Data jsou v Supabase (Postgres); přístup jde jen přes SQL funkce `api_*` ze `supabase/schema.sql`, tabulky jsou pro veřejný klíč zamčené.

## Nasazení

1. **Supabase:** vytvoř projekt, v *SQL Editor* spusť celý `supabase/schema.sql`.
2. **Klíče:** *Project Settings → API* → do `public/config.js` vlož Project URL a anon/publishable klíč (je veřejný, smí být v repu).
3. **GitHub:** pushni do repa, *Settings → Pages → Source: GitHub Actions*. Workflow `.github/workflows/pages.yml` nasadí `public/` při každém pushi do `main`.
4. Odkaz skupiny vypadá `https://<uživatel>.github.io/<repo>/#/g/<id>`.

## Lokálně

    python3 -m http.server -d public     # http://localhost:8000 (potřebuje vyplněný config.js)
    npm i --no-save @electric-sql/pglite && node test.mjs    # test SQL funkcí na Postgresu v paměti
