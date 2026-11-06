# UWAT Inventory

Parts inventory for UWAT VEXU Competitive Robotics. It tracks every bag of electrical parts: what's in it, how many, and which box it's in.

- **Phase 1 (in progress):** the website is done. The phone app can check parts against a board. Its inventory screens are still to come.
- **Phase 2:** NFC tags on bags. Each bag already has a reserved `tagUid` field.

## How it's organised

A **part** is a kind of thing, like `IC OPAMP GP 4 CIRCUIT 14SOIC`. A **bag** is one physical bag of it. A part can sit in several bags, and its total is the sum of them. Each bag lives in a **box**, which has a short code like `B-07`.

Every stock change is recorded with who, when, how many and why, and most can be undone.

A **board** is built from its gerbers. Each component on it is a **spot**, like `R12`. Linking a spot to a part answers "where does this go?" from the part, and "what goes here?" from the board.

From a DigiKey bag label we keep:

| Label | Stored as |
| --- | --- |
| `P/N` | Part number |
| `Desc` | Description, which also gives the category and package |
| `QTY` | Bag quantity |
| `CUST REF` | Project, used as a filter |

`IDX` isn't stored.

`CUST REF` isn't always a project. In the team's DigiKey upload files it holds designators, like `C2, C3, C16`, so those are left out of the project filter.

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
packages/shared/   Label, description and BOM parsing, search and board logic. Used by everything.
backend/           Express API, Prisma and Postgres
frontend/          Next.js website
mobile/            Expo phone app
brand/             Logos, copied from the UWAT VEXU brand guide
```

Clients download the whole inventory in one request and search it locally. At a few hundred parts this makes search instant and keeps the API small.

## Using it

- **Search** understands value shorthand: `100n` finds `0.1UF`, `4k7` finds `4.7K`, and `470r` finds `470 OHM`. Words can go in any order, so `0603 10k` works.
- **Keyboard:** `/` to search, `n` to add a bag, arrow keys to move through parts, `Esc` to close.
- **Add bag:** paste a whole label into the P/N box and it fills in the form.
- **Import:** takes a CSV, such as a DigiKey order export, or pasted label text.
- **Boxes > Print labels:** prints a sheet of box labels with QR codes for the phone app.

## Boards

Upload a board's gerbers under **Boards**, as loose files, a folder or a zip. The board fills the page with every part labelled on it. Scroll or pinch to zoom and drag to move. Zooming in adds what goes in each spot and which box it's in.

### Checking a mixed box against a board

A box often holds parts for several boards. Open the board you're building, then scan each item from the box:

- **Goes on this board** lights every spot it belongs in and says how many are needed.
- **Not for this board** names the board it belongs to, if that board has been uploaded.
- **Leave this one off** means the BOM marks that spot do not populate.

Scan with a USB scanner, which works wherever the focus is, or with the camera button. The camera needs HTTPS, or localhost. Parts are matched on the DigiKey number, then the maker's number, because one part can be sold under several DigiKey numbers. **Found** tracks what's been scanned on this computer and lists what's still missing, and found spots stay marked on the board.

The same box takes typed searches: a value (`10k`), a type (`resistor`), a size (`0603`), a designator (`R12`), a net (`SD_CMD`) or a box (`B-08`). Matching spots light up, and Enter flies to them. Hover over a part for the short answer, or click it for a small card with its wiring. Opening a part in the inventory shows a thumbnail of the board, which opens this view with its spots lit.

Gerbers and BOMs each hold part of the picture:

| Comes from | What it gives you |
| --- | --- |
| Gerbers | The board drawing, where each spot is, and what each pin connects to |
| BOM | Which part goes in each spot |
| Schematic PDF, PNG or JPEG | The real schematic, attached to the board |

Gerbers don't include part values, so a board knows nothing about its parts until you upload a BOM. **Upload BOM** takes the plain BOM from a board's `bom/` folder, the team's DigiKey upload file, or a KiCad BOM. Use the plain BOM when there is one: the DigiKey upload file leaves out parts that aren't ordered from DigiKey and spots that stay empty. Scanning and searching work from the BOM alone, with nothing in stock. Spots link to the inventory by themselves once a bag of that part is added.

Plot gerbers from KiCad with the X2 format and netlist attributes turned on. Without them, the files don't say which pad belongs to which part.

Lines like "Pull-up on SD_CMD" are worked out from the wiring alone, so treat them as a guide. Chip sizes such as "looks like 0603" are worked out from the pad layout.

## Phone app

The Expo app in `mobile/` does the board check: pick a board, scan each item from the box, and see if it belongs. It works on iOS and Android, and shares its logic with the website through `packages/shared`.

To try it on a phone, install Expo Go, put the phone on the same network as this computer, then:

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<this computer's address>:2211 npx expo start --lan
```

Scan the QR code it prints. The API has to be running with `DEV_LOGIN=1`, because the app only has dev sign-in so far. It doesn't have GitHub sign-in yet, so it can't sign in to a production server.

In dev builds, each scan is sent to the API and printed in its log as `[scan]`, which shows exactly what a real label holds.

Deployment is in [DEPLOY.md](DEPLOY.md).
