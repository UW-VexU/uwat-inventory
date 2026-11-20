# UWAT Inventory

Parts inventory for UWAT VEXU Competitive Robotics. It tracks every bag of electrical parts: what's in it, how many, and which box it's in.

- **Phase 1 (in progress):** the website is done. The phone app checks parts against a board, and every bag it scans goes into stock. Its other inventory screens are still to come.
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
                            # (db:clear-stock -- --yes empties stock again, keeping boards and boxes)
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
- **Live:** open pages update by themselves when anyone changes stock. A bag scanned on a phone pops up with a notice and flashes its row, marked **New**.

## Boards

Upload a board's gerbers under **Boards**, as loose files, a folder or a zip. The board fills the page with every part labelled on it. Scroll or pinch to zoom and drag to move. Zooming in adds what goes in each spot and which box it's in.

### Checking a mixed box against a board

A box often holds parts for several boards. Open the board you're building, then scan each item from the box:

- **Goes on this board** lights every spot it belongs in and says how many are needed.
- **Not for this board** names the board it belongs to, if that board has been uploaded.
- **Leave this one off** means the BOM marks that spot do not populate.

Scan with a USB scanner, which works wherever the focus is, or with the camera button. The camera needs HTTPS, or localhost. Parts are matched on the DigiKey number, then the maker's number, because one part can be sold under several DigiKey numbers. Every bag label scanned here, or on a phone, goes into stock, whichever board it's for. Scanning the same label again won't add it twice. The board keeps a checklist, shared by everyone: each part is still needed, in stock, or on the board. Tick a part off as soldered from the scan result or the checklist. The count shows how many parts are on the board, the same number the boards list and the phone show, and ticked parts stay marked on the drawing. Ticking doesn't change stock, since the parts may have come from an older bag.

A bag label has no description, so a new part takes its name from a board's BOM line when one lists it, and otherwise from the maker's number.

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

The Expo app in `mobile/` does the board check: pick a board, scan each item from the box, and see if it belongs. Each bag it scans is added to stock and shows up on the website straight away. From the scan result or the checklist you can tick a part off as on the board, or open its stock to take, add or count, move a bag to another box, or remove it. It works on iOS and Android, and shares its logic with the website through `packages/shared`.

To try it on a phone, install Expo Go, put the phone on the same network as this computer, then:

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://<this computer's address>:2211 npx expo start --lan
```

Scan the QR code it prints. The API has to be running with `DEV_LOGIN=1`, because the app only has dev sign-in so far. It doesn't have GitHub sign-in yet, so it can't sign in to a production server.

In dev builds, each scan is sent to the API and printed in its log as `[scan]`, which shows exactly what a real label holds.

### Using a laptop as the server from anywhere

The phone and the computer running the API don't have to share a network. [Tailscale](https://tailscale.com) joins them into a private network that works over any Wi-Fi or cellular connection, and gives the computer an address that never changes:

1. Install Tailscale on the computer and on each phone, and sign in to the same account. To let teammates in, share the computer with them from the Tailscale admin page.
2. Find the computer's name with `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`. It looks like `my-laptop.tail1234.ts.net`.
3. In the app, set **Server** to that name with the API port: `http://my-laptop.tail1234.ts.net:2211`.

Use the name, not the `100.x.x.x` address. iOS blocks plain HTTP to those addresses, and the app makes an exception only for `*.ts.net` names. Plain HTTP is fine there because Tailscale already encrypts everything between your devices. The tailnet is private, so the dev sign-in button is only open to people you've let in. A public tunnel would expose it to anyone with the link.

The app only works while the computer is awake and running the API. To build the app with this address filled in, set `EXPO_PUBLIC_API_URL` to it when building.

Deployment is in [DEPLOY.md](DEPLOY.md).
