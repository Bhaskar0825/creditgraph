# CreditGraph

**Source-linked counterparty review, with your exposure book kept in the browser.**

CreditGraph brings public disclosures, company relationships and local positions into one analyst workspace. Inspect an event's exact quote, check which company it concerns, record a decision and download an evidence brief.

This is a review prototype, **not a credit rating, default probability, loss forecast or investment recommendation**. The included replay is historical; it is not a live monitoring feed.

## Start here: no-key demo

From a checkout of this repository:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. **No `.env` file, Appwrite account, Python installation, TinyFish key or AI key is needed for the demo.** Do not copy the cloud placeholders into your environment just to try it.

Prerequisites:

- **Node.js 22.12 or newer is recommended.** The locked Vite 8.3.4 and React plugin 6.1.2 declare Node support as `^20.19.0 || >=22.12.0`.
- Use npm and the committed `package-lock.json` with `npm ci`; do not replace the lockfile to resolve a Node-version error. Local verification used Node 22.22.2 and npm 10.9.7.
- **Python is optional:** local backend tests were verified with Python 3.12.3 and need no third-party packages. The Appwrite deployment manifest separately targets `python-3.14`.

### Try the workflow

1. Open **Exposure book**. The initial `SAMPLE-*` positions are synthetic, not actual holdings. Download **Sample CSV**, import your own file, or use **Clear book**.
2. Open **Evidence graph** and select a company. Relationships are cited context, not routes for propagating exposure or losses.
3. Open **Review queue**, inspect an event and follow its original source. **Approve evidence**, **Dismiss** and **Reopen review** change the demo only in this tab.
4. Download a **Brief** from the event detail panel. It includes the quote, citation, dates, review state and directly linked local exposure amounts.
5. Reload to restore the original demo. Imported positions and demo decisions are not persisted.

Public-source extraction and collection require the optional cloud setup below. The demo does not pretend to run those services locally.

## What the replay represents

The fixtures in [`src/sample-data.js`](src/sample-data.js) cite the **23 June 2025 CareEdge revised rating rationale for IREDA**:

[Original CareEdge PDF](https://www.careratings.com/upload/CompanyFiles/PR/202506130648_Indian_Renewable_Energy_Development_Agency_Limited.pdf)

- **Gensol** is the borrower named in the investigation/allegation evidence and the historical expectation of NPA slippage. Allegations are not independent legal findings; an expectation is not an actual default or proof of current account status.
- **IREDA** is the lender and rated/report entity. Its instrument withdrawal following redemption is not a downgrade. The source publisher is **CareEdge**, not IREDA.
- The source's approximately **INR 728.95 crore** account outstanding as of **31 March 2025** is public relationship context, not an imported portfolio position.
- The investigation fixture records April 2025 with **month precision**, not a claimed exact event day. Publication, event and first-captured dates have different meanings.

The replay is human-curated. It is not a demonstration that the automated extractor can recover every seeded event. Totals use only the current in-tab positions, initially the clearly labelled synthetic sample; public relationship amounts never enter them.

## Exposure CSV contract

The header must match exactly, in this order, without spaces:

```csv
position_id,entity_id,currency,amount,as_of
POSITION-001,gensol,INR,1000.25,2025-03-31
POSITION-002,ireda,USD,50.00,2025-03-31
```

These example amounts are illustrative, not actual holdings.

- `position_id`: a nonblank identifier, unique to the position across imports.
- `entity_id`: an exact known ID in the current workspace. The bundled IDs are `gensol`, `ireda` and `ireda-ifsc`. Company names do not substitute for IDs in this CSV.
- `currency`: `INR`, `USD`, `EUR` or `GBP`.
- `amount`: non-negative decimal text with at most two decimal places. No currency symbols, thousands separators, exponent notation or negative signs.
- `as_of`: a valid `YYYY-MM-DD` calendar date.
- The UI accepts files up to 1,000,000 bytes. Quoted CSV fields and a UTF-8 byte-order mark are supported.

**The first successful import replaces the synthetic sample. Later imports merge by position ID.** Identical duplicates are counted once; a conflicting duplicate or any invalid row rejects the entire UI import and leaves the existing book unchanged. To replace an existing position deliberately, use **Clear book** and import the intended complete book. **Load sample** also replaces the current in-tab book.

Amounts are stored as exact integer minor-unit strings and aggregated with `BigInt`. Currencies remain separate. There is no FX conversion, netting, as-of snapshot selection or graph-based exposure propagation: different position IDs count separately, including across different dates. Supply the snapshot you intend to analyze.

## Privacy: what stays local and what leaves

- **Imported positions stay in browser memory.** CSV rows, position IDs and amounts are not sent by the portfolio workflow to Appwrite, TinyFish or an AI provider. Reloading clears imports, even in cloud mode.
- **Downloaded briefs contain local exposure amounts.** They become files under your control; review them before sharing.
- **Cloud mode is not offline.** Public source text and metadata, extracted candidates, collection results, analyst decisions and analyst notes are stored through Appwrite in the connected user's workspace. Notes may themselves be sensitive; do not include holdings or secrets in them.
- TinyFish receives the submitted public URL and company label. Optional AI receives public source text, the report-entity ID and a minimal entity dictionary. Do not paste private material into source fields; input guards are not a general data-loss-prevention system.
- Appwrite session cookies, or a fallback token in session storage, maintain the browser identity. Switching **Back to demo** does not sign out or delete the cloud session.

## Optional cloud workspace

Cloud adds persistent analyst decisions, private source candidates and server-side extraction. **TinyFish and AI are independently optional; deterministic extraction needs neither key.**

You need an Appwrite project with TablesDB, encrypted long-text columns and the Function runtime/scopes below. Use the Appwrite Console for provisioning. [`docs/appwrite-schema.json`](docs/appwrite-schema.json) is the configuration contract, not an automatic migration or seed command.

### 1. Configure browser access and sessions

In your Appwrite project:

1. Add a **Web platform** for each frontend hostname you will use. Register `localhost` for local development, and your own deployed hostname separately; register any other development hostname you actually use.
2. Enable **anonymous sessions** in the project's authentication settings. The app first reuses an existing Appwrite account session, or creates an anonymous one when the account request returns 401.
3. Use the project's API endpoint, including `/v1`, and project ID from the Console. Do not use a Console page URL as the API endpoint.

Anonymous sessions provide a private workspace tied to a browser identity, not durable account enrollment or enterprise SSO. Clearing cookies/session storage or changing browser profiles may lose access. The app does not include recovery or account management.

### 2. Create the TablesDB schema

Create database ID **`creditgraph`** and these five table IDs exactly:

```text
entities
events
relationships
reviews
runs
```

For **every** table:

- Enable the table and **row security** (`rowSecurity: true`).
- Leave table permissions **empty** (`[]`): no client read, create, update or delete grants.
- Add required, non-array `owner`: **varchar**, size **128**, encryption **off**.
- Add required, non-array `kind`: **varchar**, size **64**, encryption **off**.
- Add required, non-array `payload`: **longtext**, encryption **on**. It holds a serialized JSON string, not nested database columns.
- Add index **`owner_lookup`**, type **key**, columns **`owner`**, order **ascending**.
- Wait until all columns and the index are **available/ready** before seeding or connecting. Reopen their settings and verify readiness and payload encryption; a submitted creation request is not enough.

Rows also have **empty permissions** (`[]`). Only the server Function accesses them; the browser does not query TablesDB directly. `owner` and `kind` are unencrypted routing metadata. Payload encryption uses Appwrite's configured at-rest encryption, not end-to-end encryption against the server administrator.

The database/table IDs are fixed in `storage.py`. There is no frontend variable for changing them. Do not substitute legacy collections/documents for TablesDB tables/rows, or grant public table access to work around an error.

### 3. Seed the public reference records

A new cloud database is empty: the Function does not copy the demo automatically. Run this **read-only export** from the repository root. It prints one JSON envelope per row and makes no network requests:

```sh
node --input-type=module -e '
import { sampleData } from "./src/sample-data.js";
for (const tableId of ["entities", "events", "relationships"]) {
  for (const item of sampleData[tableId]) {
    console.log(JSON.stringify({
      tableId,
      rowId: item.id,
      data: { owner: "public", kind: tableId, payload: JSON.stringify(item) },
      permissions: []
    }));
  }
}
'
```

The current seed emits **8 rows: 3 entities, 3 events and 2 relationships**. It intentionally exports no positions, reviews or runs.

For each envelope, create a row in the Console:

1. Select database `creditgraph` and the table named by `tableId`.
2. Set the custom row ID to `rowId`; do not generate a different ID. Relationships and event references depend on these IDs.
3. Map `data.owner` to the `owner` column and `data.kind` to `kind`.
4. Set `payload` to the **decoded string value** of `data.payload`. Parse the outer JSON envelope once; do not paste its JSON-escaped `\"` representation or wrap the payload in another JSON string. The stored text should itself parse into the original item object.
5. Explicitly leave row permissions empty. Read back the row and verify its ID, owner, permissions and parsed payload against the export.

For an administrator using a TablesDB SDK instead, the envelope maps to `createRow({ databaseId: "creditgraph", tableId, rowId, data, permissions: [] })`. The printed JSONL is a mapping reference, not a file accepted by the app's exposure importer or an automatic Console import. No administrative key belongs in frontend code.

Keep `reviews` and `runs` empty; the Function creates owner-scoped records. `owner: "public"` means shared reference content **through the Function**, not publicly readable database rows. Before repeating a seed, inspect existing IDs rather than overwriting analyst work. Adding companies requires administrative entity records; the UI has no entity-management screen.

### 4. Deploy the Python Function

Create Function ID **`creditgraph-api`** with the exact manifest settings:

- Runtime: **`python-3.14`**.
- Entrypoint: **`src/main.py`**; callable `main(context)`.
- Build command: **`python -m compileall -q src`**.
- Timeout: **30 seconds**.
- Execute permission: **`any`**.
- Dynamic API-key scopes: **`rows.read`**, **`rows.write`**, **`tables.read`**.

If your Appwrite installation does not offer this runtime or schema capability, stop and resolve compatibility rather than silently choosing a different deployment contract. The code uses only Python's standard library; `requirements.txt` contains no dependencies.

Package from the repository root:

```sh
tar --exclude='__pycache__' --exclude='*.pyc' \
  -czf creditgraph-function.tar.gz \
  -C functions/creditgraph src requirements.txt
tar -tzf creditgraph-function.tar.gz
```

The archive root must contain **`src/` and `requirements.txt`**, with `src/__init__.py`, `src/main.py` and its sibling modules. Do not wrap them inside `creditgraph/` or upload the frontend `src/`. Upload the archive as a Function deployment, wait for its build to be ready, activate it and ensure the Function is enabled.

The runtime supplies the API endpoint, project identity and request dynamic key. Their fallback server variables and the full action contract are documented in the [Function README](functions/creditgraph/README.md). No browser server key is needed.

**`execute: any` is a platform execution gate, not permission to read all data.** The backend allows only `health` without identity; every data action checks the Appwrite-injected user ID and applies ownership checks. Dynamic scopes authorize the Function's storage access, not the caller's identity. Do not expose a proxy that trusts caller-supplied Appwrite identity headers. Before public deployment, verify runtime-header authenticity and cross-user isolation on your own installation.

### 5. Set public frontend configuration

Create an optional **`.env.local`** in the repository root with only these public values, replacing the generic placeholders:

```dotenv
VITE_APPWRITE_ENDPOINT=https://your-appwrite.example/v1
VITE_APPWRITE_PROJECT_ID=your-project-id
VITE_APPWRITE_FUNCTION_ID=creditgraph-api
```

You can copy `.env.example` to `.env.local` as a starting point, then edit it. **Every `VITE_*` value is browser-visible**, including in the built bundle. Never add Appwrite administrative keys, TinyFish keys or AI keys there.

Restart `npm run dev` after changing local configuration. For a deployed frontend, provide the same three public values to the build environment or an uncommitted `.env.production.local`, then rebuild:

```sh
npm run build
npm run preview
```

Deploy **`dist/`** to a static host. There is no application Node.js server or SSR requirement. Environment changes after the build do not reconfigure an existing bundle. Register the deployed hostname as an Appwrite Web platform, then choose **Connect private workspace** in the app. The app still opens in demo mode on reload; reconnect to load saved cloud evidence. Local positions must be reimported.

### 6. Optionally enable collection or AI

Configure these only in the **Appwrite Function's server environment**, not a frontend dotenv file:

- **TinyFish:** `TINYFISH_API_KEY`. Collection submits a public document and uses owner-checked polling; completed text must still be extracted and reviewed separately.
- **AI:** all of `AI_ENDPOINT`, `AI_API_KEY` and `AI_MODEL`. The endpoint is an OpenAI-compatible HTTPS base URL, commonly ending in `/v1`; the adapter appends `/chat/completions` and requires strict JSON-schema responses.
- Leave **all three AI variables unset** for deterministic rules. Partial AI configuration fails extraction rather than silently falling back.

Allowed source domains for both extraction and collection are `careratings.com`, `icra.in`, `bseindia.com`, `nseindia.com`, `bis.org` and `ireda.in`, including valid subdomains. Only HTTPS sources without credentials, explicit ports or fragments are accepted. Generic example hosts are not allowed disclosure sources.

Set provider-side spending limits before enabling paid services. **Configured** flags show variable presence, not successful authentication or provider quality. No live TinyFish or AI execution is claimed by the local tests. See the [backend setup and troubleshooting](functions/creditgraph/README.md) and [TinyFish API reference](https://docs.tinyfish.ai/agent-api/reference).

## Verify your setup

### Local checks

From the repository root:

```sh
npm test
python3 -B -m unittest discover -s tests -p 'python*.py' -v
npm run build
```

The checked baseline is **36 passing JavaScript tests and 40 passing Python tests**. These cover CSV/money handling, review priority, historical fixtures, client payloads, extraction, storage/ownership logic and provider adapters. Backend integration tests substitute HTTP transport; separate urllib tests use a real loopback server. They do **not** prove a live Appwrite installation, paid-provider connectivity or model quality.

Manual demo smoke check: import the sample CSV, reimport it and confirm no double counting; try a conflicting duplicate and confirm the book is unchanged; approve and reopen evidence; open graph details; download a brief; reload and confirm the demo resets. Inspect browser network requests during an import to verify that the file is not uploaded.

### Cloud smoke check

After provisioning your own project:

1. Check integration status: `health` should return the service name and configuration flags. This does not test TablesDB access.
2. Connect; confirm the seeded entities, events and relationships load.
3. Review a public event and add a non-sensitive note. Refresh the workspace, then reload/reconnect; the decision and note should remain, while local positions reset.
4. With AI unset, paste an exact supported public sentence from the cited source, keeping its original URL and publication date. Verify the candidate's subject and quote, then repeat extraction and confirm it does not duplicate that candidate. Some curated multi-company sentences are intentionally rejected as ambiguous.
5. Use a genuinely separate browser profile to create another session. It should see public seed records but not the first session's private candidates, notes or collection runs.
6. As deployment owner, verify direct TablesDB access remains denied, unauthenticated data actions fail and forged identity headers cannot impersonate another user. A working `health` action alone proves none of these boundaries.

Paid-provider smoke tests are a separate, potentially billable step. Do not turn them on just to prove the no-key demo works.

## Troubleshooting

- **Install/build reports an unsupported engine:** use a Node version supported by the locked Vite/plugin packages, then rerun `npm ci`. Do not delete the lockfile as a workaround.
- **“Cloud workspace is not configured”:** the demo still works. For cloud, supply the public endpoint/project/function values, restart Vite or rebuild the static bundle.
- **Network/CORS or session errors:** verify the API endpoint and project, register the actual frontend hostname, enable anonymous sessions and check browser cookie/session-storage restrictions. Do not conceal the issue with a proxy that rewrites identity headers.
- **Cloud connects but is empty:** a fresh database has no seed. Confirm exact database/table IDs and seed row IDs, `owner: "public"`, valid JSON payloads and ready owner indexes. Empty cloud results do not automatically fall back to demo fixtures.
- **Unknown column, missing index or storage 503:** compare every table with `docs/appwrite-schema.json`; check column/index readiness, runtime storage variables and dynamic key scopes. Do not grant public permissions.
- **Function build/import failure:** inspect the archive listing, Python runtime, entrypoint and active deployment. The Function must receive the backend `src/`, not the React one.
- **CSV rejected:** correct the exact header, IDs, currencies, decimal format, dates or conflicting duplicates. Any error prevents the whole import. Clear the book first only when intentionally replacing it.
- **No extracted candidates:** check known names/aliases, source allowlist and complete quotes. Negation, ambiguity, unsupported wording and multi-company attribution can legitimately produce no candidate. Do not rewrite source text merely to force acceptance.
- **AI configuration/validation error:** set all three server variables or remove all three. The provider must support the requested schema; invalid output fails closed.
- **TinyFish unavailable or stuck:** confirm the server key, allowed original URL and provider status. Refresh an existing run rather than repeatedly creating new ones. After an ambiguous creation or timeout, inspect provider state before retrying to avoid duplicate charges.
- **429, changing workspace or row-limit error:** wait for the per-process request window, refresh after concurrent writes, or reduce the dataset deliberately. Bootstrap caps visible rows at 2,000 per table and rejects incomplete pagination.
- **Positions disappeared:** expected on reload; reimport your CSV. **Cloud decisions disappeared:** reconnect with the same session. A new anonymous identity cannot recover the previous one's private records.

## Architecture and repository map

React renders the workspace; Cytoscape renders the relationship graph. Pure browser domain functions validate CSVs, aggregate exact amounts and prepare briefs. The browser calls Appwrite's execution API only on explicit cloud actions. The Python Function handles authorization, TablesDB, extraction and optional provider calls.

```text
src/
  App.jsx          Workspace screens and in-memory UI state
  Graph.jsx        Relationship graph
  api.js           Public configuration, session and action client
  domain.js        CSV, exact money, review queue and brief export
  sample-data.js   Cited historical fixtures and synthetic CSV
  main.jsx         React entrypoint
  styles.css       Interface styles
functions/creditgraph/
  src/             Python entrypoint, services and provider adapters
  requirements.txt Standard-library-only runtime
  README.md        Deployment and API reference
docs/appwrite-schema.json
tests/             JavaScript and Python regression suites
```

Root `package.json`, `package-lock.json`, `vite.config.js` and `index.html` define the frontend build; `.env.example` documents optional public configuration.

## Limitations before production use

- Queue priority is a rule: material-risk candidates with positive direct exposure are medium; approved material-risk evidence with positive direct exposure is high. Approval confirms an analyst's evidence decision, not misconduct, current credit status or expected loss.
- Extraction uses conservative wording and name heuristics, not general grammatical understanding. Exact quote membership proves only that text was submitted, **not that it is authentic to the cited URL**. Human source review is required.
- Automatic event dates recognize ISO dates only; multiple distinct dates yield no event date. Even a single detected date needs a source check. Publication-age labels do not establish currentness.
- Requests are on demand, not continuous monitoring. Per-process rate limits are not distributed quotas or billing ceilings. Candidate writes are idempotent but not a multi-row transaction; storage failures can leave a partial set saved.
- Anonymous identity, recovery, access enrollment, organizational permissions, backups, retention and abuse controls need further work before regulated or untrusted public multi-tenant use.
