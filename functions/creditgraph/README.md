# CreditGraph Appwrite Function

Python backend for private evidence workspaces, analyst reviews and optional public-source collection. The React demo runs without this Function; follow the [main README](../../README.md) for the no-key quickstart and frontend setup.

The Function uses **TablesDB**, not legacy collections/documents. It does not create its schema, seed reference data or accept portfolio uploads.

## Deploy from a fresh project

### Storage prerequisites

Use [`docs/appwrite-schema.json`](../../docs/appwrite-schema.json) as the deployment contract. It is a reference manifest, not an automatic provisioning script.

Create database ID `creditgraph` with enabled tables `entities`, `events`, `relationships`, `reviews` and `runs`. On **every table**, set:

- `rowSecurity: true` and table `permissions: []`.
- Required, non-array `owner`: varchar, size 128, encryption off.
- Required, non-array `kind`: varchar, size 64, encryption off.
- Required, non-array `payload`: longtext, encryption on.
- Index `owner_lookup`: type `key`, column `owner`, ascending order.

Wait for all columns and indexes to become **available/ready**, then read their configuration back. Rows must also have `permissions: []`. Keep table access server-only; do not grant browser or public read/write access to fix an authorization error. The Function's URLs are `/tablesdb/creditgraph/tables/{table}/rows`; database and table IDs are fixed in `storage.py`.

Each row stores `{owner, kind, payload}`, where `payload` is a serialized JSON object. The application caps that string at **60,000 UTF-8 bytes**. `owner` and `kind` remain unencrypted routing metadata; Appwrite's configured payload encryption is at-rest protection, not end-to-end secrecy from the server administrator.

Seed the three public reference tables using the runnable Node export and exact Console/SDK mapping in [Public reference records](../../README.md#3-seed-the-public-reference-records). Use each fixture's `id` as the row ID, `owner: "public"`, `kind` equal to the table name and `payload: JSON.stringify(item)`. The current export yields 3 entities, 3 events and 2 relationships. Never seed `reviews` or `runs` as public, and never copy `SAMPLE_CSV` into cloud storage. Public rows are shared only through the authenticated Function, not via public table permissions.

### Function settings

Create an enabled Function with these settings from the manifest:

```text
Function ID:        creditgraph-api
Runtime:            python-3.14
Entrypoint:         src/main.py
Callable:           main(context)
Build command:      python -m compileall -q src
Timeout:            30 seconds
Execute permission: any
Dynamic key scopes: rows.read, rows.write, tables.read
```

If your installation lacks this runtime or TablesDB/encryption capability, resolve compatibility before deployment rather than silently changing the contract. The backend has **no third-party dependencies**; `requirements.txt` documents standard-library-only operation. The manifest build command compiles the modules, not a dependency installation.

Run from the repository root:

```sh
tar --exclude='__pycache__' --exclude='*.pyc' \
  -czf creditgraph-function.tar.gz \
  -C functions/creditgraph src requirements.txt
tar -tzf creditgraph-function.tar.gz
```

The archive must contain `src/` and `requirements.txt` at its root. Include `src/__init__.py`, `src/main.py` and all sibling modules; relative imports depend on that package layout. Do not archive a surrounding `creditgraph/` directory or the React frontend's `src/`. Upload the archive, wait for a ready build, activate the deployment and verify the active entrypoint/settings.

### Authentication and browser access

Register the frontend's actual hostname as an Appwrite **Web platform**, including `localhost` separately for local development. Enable **anonymous sessions**. The browser reuses an existing account session or creates an anonymous one, then calls the Appwrite execution API directly.

**`execute: any` permits reaching the Function, not unrestricted data access.** The code allows only `health` without an identity. `bootstrap`, `review`, `extract`, `collect` and `runStatus` require a valid Appwrite-injected `x-appwrite-user-id`; `public` is not accepted as a caller identity. Data actions apply per-owner storage checks, and reviews never mutate public event status.

Dynamic key scopes authorize the Function to access TablesDB; they do not authenticate a browser user. Do not put a server key in the browser or expose a proxy that trusts caller-supplied Appwrite identity headers. On the actual deployment, test that forged execution headers cannot impersonate another user and that a second browser identity cannot read the first identity's candidates, reviews or runs. Local header tests cannot prove the platform's injection behavior.

Anonymous workspaces are tied to browser identity, not durable enrollment/SSO. The UI has no account recovery; cookie/session-storage loss can make earlier records inaccessible. Returning to demo mode is not sign-out.

## Environment variables

### Appwrite runtime and optional fallbacks

The runtime normally supplies these; do not provision a permanent key when the dynamic key is available:

- Endpoint: `APPWRITE_FUNCTION_API_ENDPOINT`, falling back to `APPWRITE_ENDPOINT`.
- Project: `APPWRITE_FUNCTION_PROJECT_ID`, falling back to `APPWRITE_PROJECT_ID`.
- Key: request header `x-appwrite-key`, falling back to server-only `APPWRITE_API_KEY`.

Endpoint values are API base URLs including `/v1`. A deployment missing any endpoint/project/key value returns **“Workspace storage is not configured.”** for data actions. `health` does not construct the storage client and can still succeed.

Frontend configuration is separate: `VITE_APPWRITE_ENDPOINT`, `VITE_APPWRITE_PROJECT_ID` and `VITE_APPWRITE_FUNCTION_ID` are public build-time identifiers. **No server secret may use the `VITE_` prefix.** A frontend `.env.local` does not set the Appwrite Function environment; configure server variables in the Function's Console settings.

### Optional TinyFish collection

Set **`TINYFISH_API_KEY`** only on the Function. No key is needed for deterministic extraction or reviews. Without it, collection returns an actionable 503 rather than simulated data.

The adapter uses the stable asynchronous lifecycle:

1. Validate the public URL and company label, then save a private local run with status `CREATING`.
2. Submit `POST https://agent.tinyfish.ai/v1/automation/run-async` and save its provider run ID as `PENDING`.
3. On `runStatus`, verify the local row's owner **before** requesting `GET https://agent.tinyfish.ai/v1/runs/{providerRunId}`.
4. Validate completed output and save the result; cache terminal states `COMPLETED`, `FAILED` and `CANCELLED`.

The provider receives only the public URL and company label, plus the collection instructions and output schema. There are no browser profiles or beta settings. The UI checks the run after creation; use its refresh control for later progress. Completed text is not automatically evidence: inspect it, then submit it through extraction separately.

Set provider budgets before enabling collection. A timeout or ambiguous creation can mean the provider accepted a run even though this Function could not confirm it; check provider state before retrying. Requests are not automatically retried. See the [TinyFish API reference](https://docs.tinyfish.ai/agent-api/reference).

### Optional model extraction

Set **all three** server variables together:

- `AI_ENDPOINT`: an OpenAI-compatible **HTTPS API base URL**, commonly `https://your-model-provider.example/v1`; the adapter appends `/chat/completions`. Do not include that final path twice.
- `AI_API_KEY`: server-only provider credential.
- `AI_MODEL`: the exact model identifier supported by that provider.

The provider must support `response_format: json_schema` with strict schemas. The adapter requests temperature 0, at most 2,500 output tokens and a 20-second HTTP timeout. These settings do not guarantee completion within the Function's total execution timeout.

Leave **all three unset** for `deterministic_rules` extraction. If any is set, the model path is selected; partial configuration returns 503. Invalid model output fails closed instead of being presented as a successful rules fallback. `health.aiConfigured` is true only when all three values are present, and says nothing about connectivity.

Only public source text, report-entity ID and a minimal entity dictionary (`id`, `name`, `aliases`, `role`) are sent. Private positions are not an input to this API. Do not paste confidential information into source text or analyst notes; keyword/field checks are not comprehensive data-loss prevention.

No live TinyFish/model call or model quality metric is established by the repository's local tests.

## Execution API contract

Use Appwrite's execution API with a **JSON-string `body`** containing an `action`. For example, the outer request body for a read-only health action is:

```json
{
  "body": "{\"action\":\"health\"}",
  "async": false,
  "method": "POST",
  "path": "/",
  "headers": { "content-type": "application/json" }
}
```

The frontend sends this to `/functions/{functionId}/executions` with the project identifier and session. Do not supply a user identity in the action body or try to authenticate by forging headers.

Appwrite wraps the Function response: inspect **`responseStatusCode`** and parse the **`responseBody` string**. The Function's inner object is `{ok: true, ...}` or `{ok: false, error}`; a successful outer HTTP response is not proof that the action succeeded. Every Function response has `Cache-Control: no-store`.

### `health`

Input: `{action: "health"}`.

Returns `{ok, service: "CreditGraph", tinyfishConfigured, aiConfigured}`. This is the only action allowed without a user identity. Flags indicate environment-variable presence, not a ready database, valid key, successful provider request or active seed.

### `bootstrap`

Input: `{action: "bootstrap"}`.

Returns `{ok, entities, events, relationships, reviews, runs}`. The first three tables include `public` plus the caller's rows; reviews/runs include only the caller's rows. Query filtering is followed by an ownership filter in Python. The authoritative record ID is the storage row ID, not an untrusted `payload.id`.

Lists use 100-row cursor pages with a maximum of 2,000 visible rows per table. Inconsistent totals, incomplete pages, repeated IDs and overflow fail rather than silently truncating the workspace. Reviews are returned separately; the frontend overlays the caller's status/note onto events.

### `review`

Input fields: `eventId`, `status` (`candidate`, `approved` or `dismissed`), optional `note` up to 2,000 characters.

Returns `{ok, review}`. The event must be accessible to the caller. Review IDs are deterministic per owner/event; writes check ownership, set empty row permissions and read the exact record back. Approval records an analyst decision, not an established finding of misconduct or a loss forecast.

### `extract`

Input fields: `text`, `sourceUrl`, optional `publishedAt`, `issuerId`, `sourceTitle`, `page`.

- Text must be nonblank and at most 30,000 characters.
- Source URL must pass the server allowlist below.
- `issuerId`, when supplied, must be a known entity ID. It is report metadata, not an instruction to attribute the event to that entity.
- Title is at most 300 characters; page is an integer from 1 to 10,000.
- Use `YYYY-MM-DD` for publication dates in the frontend. The backend also accepts parseable ISO date/time metadata, but its publication-age label only recognizes date-only values; retain and review the original date semantics.
- Explicit portfolio/exposure/key/endpoint/model fields are rejected. Do not send private data inside otherwise permitted text fields.

Returns `{ok, events, mode}` with at most 30 private `candidate` events. `mode` and event `extractionMethod` are `deterministic_rules` or `ai_validated`. The former is **not AI**.

Both paths require complete exact source quotes, a uniquely matched known subject name/alias and supported event wording. Quotes over 1,500 characters, ambiguous attribution, recognized negations and hypothetical/instruction-like sentences are rejected. The AI path additionally validates every returned field and exact sentence; one invalid item rejects the model result before saving candidates.

Repeated extraction uses owner-scoped deterministic IDs and preserves `firstSeenAt`. Multi-event persistence is **not transactional**: a storage failure after earlier writes can leave some candidates saved. Refresh before retrying.

### `collect`

Input fields: `url`, `companyName` (1–160 characters, no control characters). No other action fields are accepted.

Returns `{ok, runId, status}` for a private local run after provider creation is confirmed and stored. Missing TinyFish configuration returns 503. Submission does not approve evidence or run extraction.

### `runStatus`

Input: `runId`, the **local** CreditGraph run ID returned by `collect`, not the provider ID.

Returns `{ok, runId, status, results, error}`. On successful completion, `results` contains `{text, sourceUrl, sourceTitle, publishedAt}`. The source URL must exactly match the originally submitted URL; text and metadata are bounded. Failed, cancelled or invalid output is explicit and never creates events. Collected text remains untrusted.

## Attribution and date semantics

`entityId` identifies the event subject. `documentIssuerId` preserves input `issuerId` separately. In the historical fixtures this legacy field means **report subject/rated entity** (IREDA), not publisher; the publisher is CareEdge.

The issuer is **not simply removed before deciding who a sentence concerns**:

- Entities whose role is exactly `rating_agency`, `regulator` or `publisher` are ignored as candidate subjects.
- A company issuer is still counted among same-sentence company matches, so selecting it as metadata cannot hide an ambiguous co-mention.
- Only an explicit leading `<issuer name> reports:` prefix is removed for matching that issuer. A repeated mention in the reported clause still counts.
- After counting, the sentence is accepted only when exactly one subject remains **and it is not the supplied issuer**. This conservative rule can also miss genuine events about a report entity; do not falsify metadata to force a candidate.

The Gensol regression uses a separately attributed source fragment or the explicit expected-NPA sentence. It does not establish that every full multi-company paragraph in the curated historical seed is automatically extractable. The original longer investigation sentence mentions both IREDA and Gensol and is conservatively rejected by the current automated matcher.

Automatic dates recognize only ISO calendar dates inside the quote. Multiple distinct dates yield `eventDate: null`; even a single date requires an analyst to check its attachment to the event. The automatic `historical` flag is based on a parseable date-only publication value being before the current UTC day, not on current borrower status. An absent/unparseable date does not prove recency.

Exact membership proves only that the quote occurs in the submitted text, **not that the paste is authentic to the source URL**. This is bounded heuristic extraction, not general grammatical understanding, source verification, autoapproval, contagion propagation or financial advice.

## Limits and network boundary

- Request body: 200,000 bytes maximum.
- Upstream JSON response: 2,000,000 bytes maximum.
- Per warm Function process, per caller, per minute: `collect` 3, `extract` 6, `review` 30, `bootstrap` 20, `runStatus` 30.
- These limits are best-effort abuse reduction, **not distributed quotas or spending ceilings**. Configure provider-side budgets and production access controls separately.
- Approved source domains for extraction and collection: `careratings.com`, `icra.in`, `bseindia.com`, `nseindia.com`, `bis.org`, `ireda.in`, plus valid dot-boundary subdomains.
- Source URLs must be HTTPS. Userinfo, explicit ports, fragments, IP hosts, malformed labels, control characters and spoofed domain suffixes are rejected. Remove a PDF `#page=...` fragment and use the separate `page` field when appropriate.
- The urllib transport refuses HTTP redirects to prevent credential forwarding. TinyFish receives a no-navigation/no-login instruction and changed result URLs are rejected, but those checks **are not a browser network sandbox guarantee**; provider enforcement remains separate.
- External requests are not automatically retried. Errors are sanitized rather than exposing provider bodies, keys or source text.

## Local verification

From the repository root, with Python 3.12 (local verification used 3.12.3):

```sh
python3 -B -m unittest discover -s tests -p 'python*.py' -v
```

No pip installation or provider configuration is required. The current backend baseline is **40 passing tests**. Tests exercise the real extractor, action boundary, storage and provider adapters; integration cases substitute only the HTTP transport. urllib behavior also runs against a real loopback HTTP server. Run the frontend tests separately with `npm test` (36 passing tests in the checked baseline).

A deployment owner must separately verify:

1. Active runtime, build, entrypoint, scopes, schema encryption/readiness and seed readback.
2. Health from an unauthenticated caller, with data actions denied without identity.
3. Bootstrap, a private review/note and repeat extraction surviving reload/reconnect.
4. Cross-user isolation with two genuinely distinct sessions and direct TablesDB access denied.
5. Authentic Appwrite-injected identity headers, including attempted spoofing through the exact execution path.
6. Optional live paid-provider connectivity and observed output, only after budgets and authorization are in place.

Do not use a successful health response, simulated provider test or ready build as evidence that all of these checks passed.

## Troubleshooting

- **Build fails or module imports fail:** verify `src/` and `requirements.txt` are archive-root entries, preserve `src/__init__.py`, use the backend files and match `python-3.14` / `src/main.py` / `python -m compileall -q src`.
- **Health works but bootstrap fails:** health bypasses storage. Check TablesDB availability, exact IDs, ready columns/indexes, runtime endpoint/project/key and dynamic scopes.
- **Cloud is empty:** no automatic seed exists. Verify the public rows and parsed JSON payloads; do not paste the export envelope itself into `payload`.
- **401 or missing identity:** enable anonymous sessions, register the browser hostname and connect through the Appwrite execution API. Changing row permissions does not repair caller authentication.
- **CORS/network failure:** use the actual API endpoint and Web platform origin. Do not accept caller-supplied identity headers through a workaround proxy.
- **Record privacy verification failed:** inspect the exact row permissions and ownership. Expected permissions are `[]`; investigate existing grants instead of broadening access.
- **Write could not be verified / pagination changed:** refresh and inspect the saved state before retrying. Concurrent changes or partial multi-event writes may have occurred.
- **No candidates:** examine names/aliases, co-mentions, negation, quote boundaries and supported event wording. No event can be a valid conservative result; never invent a simpler quote to pass validation.
- **AI partially configured or schema validation fails:** configure all three model variables or unset all three. Verify provider JSON-schema support separately. There is no fallback masquerading as AI.
- **TinyFish 503:** add the key in the Function environment, not the browser. A true configured flag still does not prove provider authentication.
- **Collection timeout/uncertain creation:** check the saved run and provider dashboard before starting another potentially charged run. Refresh the existing local run for progress.
- **429 or row-limit errors:** allow the request window to elapse; reduce an oversized workspace deliberately. Public launch needs distributed abuse controls beyond these process-local limits.
