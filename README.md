# Better You Akademie

Samostatný web Akademie (kurzy marketingu a AI pro kosmetické salony). Node.js bez frameworku, bez povinných závislostí.

## Spuštění lokálně

```
node server.js            # http://localhost:3000, data v ./data/db.json
```

Výchozí účty: `admin` / heslo z `ACADEMY_ADMIN_PASSWORD` (jinak `admin`), ukázková členka `user` / `user`.

## Proměnné prostředí

| Proměnná | K čemu |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Trvalé úložiště dat (bezplatná databáze Supabase). Bez nich se data ukládají do souboru, který na Renderu zdarma při každém nasazení zmizí. |
| `STRIPE_SECRET_KEY` | Platby kartou (stejný klíč jako na better-you.cz). |
| `STRIPE_WEBHOOK_SECRET` | Podpis webhooku `https://<adresa>/api/stripe/webhook` (obnovy členství). |
| `MAILGUN_API_KEY` (+ `MAILGUN_DOMAIN`, `MAILGUN_REGION`) nebo `SMTP_*` | E-maily (potvrzení, faktury, obnova hesla). |
| `PUBLIC_URL` | Veřejná adresa webu, např. `https://better-you-akademie.onrender.com`. |
| `ACADEMY_ADMIN_PASSWORD` | Heslo administrátora při prvním spuštění. |
| `IMPORT_FROM` | Jednorázový přenos účtů, objednávek a faktur ze starého webu (`https://www.better-you.cz`). Proběhne jen při prázdném úložišti. |
| `ACADEMY_META_PIXEL`, `META_CAPI_TOKEN`, `GA4_ID`, `GA4_SECRET` | Měření konverzí (volitelné). |
| `NOTIFY_EMAIL`, `MAIL_FROM` | Kam chodí upozornění a kdo je odesílatel (výchozí info@better-you.cz). |

## Supabase (jednorázově)

V Supabase → SQL Editor spusťte:

```sql
create table if not exists kv (id text primary key, data jsonb not null, updated_at timestamptz default now());
alter table kv enable row level security;
```

Do Renderu pak vložte `SUPABASE_URL` (Project Settings → API → Project URL) a `SUPABASE_SERVICE_KEY` (klíč `service_role`).

## Faktury

Vlastní číselná řada `AK` + rok + pořadí (např. `AK20260001`). Dodavatel BY studios s.r.o., neplátce DPH.
