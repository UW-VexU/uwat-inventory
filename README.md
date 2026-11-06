# UWAT Inventory

Parts inventory for UWAT VEXU Competitive Robotics. It tracks every bag of electrical parts: what's in it, how many, and which box it's in.

- **Phase 1 (in progress):** the website is done. The phone app is next.
- **Phase 2:** NFC tags on bags. Each bag already has a reserved `tagUid` field.

## How it's organised

A **part** is a kind of thing, like `IC OPAMP GP 4 CIRCUIT 14SOIC`. A **bag** is one physical bag of it. A part can sit in several bags, and its total is the sum of them. Each bag lives in a **box**, which has a short code like `B-07`.

Every stock change is recorded with who, when, how many and why, and most can be undone.

From a DigiKey bag label we keep:

| Label | Stored as |
| --- | --- |
| `P/N` | Part number |
| `Desc` | Description, which also gives the category and package |
| `QTY` | Bag quantity |
| `CUST REF` | Project, used as a filter |

`IDX` isn't stored.

## Running it locally

You need Node 24 and Postgres 16.

```bash
createdb uwat_inventory_dev
createdb uwat_inventory_test

cd backend
npm install
cp .env.example .env        # set DATABASE_URL for your Postgres
npx prisma migrate dev
npm run db:seed             # about 260 made-up parts to try things with
npm run dev                 # API on :2211

cd ../frontend
npm install
npm run dev                 # site on http://localhost:2210
```

With `DEV_LOGIN=1` in `backend/.env`, the sign-in page has a dev button, so you don't need GitHub keys. This is always off in production.

## Tests

```bash
npm test             # shared logic and the API. The API tests need Postgres.
npm run typecheck
```

The API tests use a database called `uwat_inventory_test`. Set `TEST_DATABASE_URL` to use a different one.

## Layout

```
packages/shared/   Label parsing, description parsing, search and CSV. Used by everything.
backend/           Express API, Prisma and Postgres
frontend/          Next.js website
brand/             Logos, copied from the UWAT VEXU brand guide
```

Clients download the whole inventory in one request and search it locally. At a few hundred parts this makes search instant and keeps the API small.

## Using it

- **Search** understands value shorthand: `100n` finds `0.1UF`, `4k7` finds `4.7K`, and `470r` finds `470 OHM`. Words can go in any order, so `0603 10k` works.
- **Keyboard:** `/` to search, `n` to add a bag, arrow keys to move through parts, `Esc` to close.
- **Add bag:** paste a whole label into the P/N box and it fills in the form.
- **Import:** takes a CSV, such as a DigiKey order export, or pasted label text.
- **Boxes > Print labels:** prints a sheet of box labels with QR codes for the phone app.

Deployment is in [DEPLOY.md](DEPLOY.md).
