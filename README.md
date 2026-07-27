# OpenSky Proxy

A small Node.js/TypeScript service that sits between a browser frontend and the
[OpenSky Network API](https://openskynetwork.github.io/opensky-api/), streaming live
aircraft state data over Server-Sent Events.

It exists to solve three problems that come up when you call OpenSky directly from a browser:

- **Credentials can't live in the frontend.** OAuth client credentials stay server-side; the
  browser never sees a token.
- **OpenSky's quota is per-account, not per-user.** A naive frontend polling on a timer burns
  quota linearly with the number of visitors.
- **CORS.** OpenSky doesn't serve browser origins.

## How it works

The core design decision is **fan-in**: no matter how many browsers are connected, the proxy
makes *one* upstream request per poll interval and broadcasts the result to every subscriber.

```
  browser ─┐
  browser ─┼── SSE ──▶  BroadcastPoller  ──▶ OpenSky /states/all
  browser ─┘              (1 request / 15s, regardless of client count)
```

`BroadcastPoller` (`polling.ts`) owns this:

- The polling interval starts on the **first** client to connect and stops on the **last** to
  disconnect — no upstream traffic when nobody is watching.
- A new client is served the last cached result immediately, so it renders without waiting up
  to a full interval for the next poll.
- Cached data older than 60s is discarded rather than served stale.
- An `is_fetching` lock prevents overlapping requests if a poll outlives its interval, and every
  poll is bounded by a timeout so a hung upstream connection can't hold that lock permanently.
- Upstream failures are broadcast as SSE `error` events; the poller keeps running and recovers
  on the next successful tick.

Access tokens are fetched lazily, cached in memory, and reused until expiry.

## Requirements

- Node.js >= 20
- An [OpenSky Network](https://opensky-network.org/) account with an API client
  (Account → API Client) for the client-credentials flow

## Setup

```bash
npm install
cp .env.example .env   # then fill in your OpenSky credentials
npm run build
npm start
```

### Environment variables

All four are required. `PORT` and `CORS_ORIGIN` are validated at startup and the server refuses
to boot without them. The OpenSky credentials are only checked on the first upstream call, so a
misconfigured deployment starts up looking healthy and then returns `401` on every request.

| Variable | Description | Example |
| --- | --- | --- |
| `PORT` | HTTP port to listen on | `5000` |
| `CORS_ORIGIN` | Comma-separated list of allowed browser origins | `http://localhost:5173,https://app.example.com` |
| `OPENSKY_CLIENT_ID` | OpenSky OAuth client id | `yourname-api-client` |
| `OPENSKY_CLIENT_SECRET` | OpenSky OAuth client secret | |

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server (expects a prior build) |
| `npm run dev` | Build and run in one step |
| `npm run typecheck` | `tsc --noEmit` |

`build` and `start` are separate so hosts that install with `--omit=dev` still work —
`typescript` is a devDependency, so `start` must never invoke `tsc`.

## API

### `GET /api/opensky/states`

An SSE stream of all aircraft states, pushed every 15 seconds.

```bash
curl -N http://localhost:5000/api/opensky/states
```

Events:

| Event | Payload | When |
| --- | --- | --- |
| `connected` | `{"ok":true}` | Once, immediately on connect |
| `success` | OpenSky states response | On connect if fresh data is cached, then every poll |
| `error` | `{"message":"..."}` | A poll failed; the stream stays open and retries |

```
event: connected
data: {"ok":true}

event: success
data: {"time":1785130898,"states":[["aa3cbe","N759PA  ","United States",1785130808,...]]}
```

Each entry in `states` is a positional array — see the
[OpenSky state vector reference](https://openskynetwork.github.io/opensky-api/rest.html#response)
for the field order.

Browser client:

```js
const source = new EventSource("http://localhost:5000/api/opensky/states")
source.addEventListener("success", (e) => render(JSON.parse(e.data).states))
source.addEventListener("error", (e) => console.warn("poll failed", e))
```

### `GET /api/opensky/tracks/:icao24`

The current flight path for a single aircraft, by its ICAO 24-bit address (lowercase hex).
Unlike `/states`, this is a direct passthrough — one upstream call per request.

```bash
curl http://localhost:5000/api/opensky/tracks/3c70cb
```

```json
{
  "icao24": "3c70cb",
  "callsign": "GEC8161 ",
  "startTime": 1785127730,
  "endTime": 1785131460,
  "path": [[1785127730, 40.6187, -73.7883, 0, 214, false]]
}
```

`path` entries are `[time, latitude, longitude, baro_altitude, true_track, on_ground]`.

| Status | Meaning |
| --- | --- |
| `200` | Track returned |
| `400` | Missing `icao24` |
| `401` | The proxy could not authenticate with OpenSky |
| `502` | Upstream request failed — **also returned when the aircraft simply has no current track** (see Limitations) |

## Project structure

```
index.ts        Express app, OpenSky auth, route handlers
polling.ts      BroadcastPoller — shared poll loop and SSE fan-out
types.ts        Auth and token payload types
bruno/          Bruno API collection for manual testing
```

Written in strict TypeScript (ESM). Conventions are documented in `AGENTS.md` —
`snake_case` for functions and constants, `PascalCase` for classes and types.

## Limitations

Known gaps, kept here deliberately rather than left as surprises:

- **`/tracks` returns 502 for aircraft with no active track.** OpenSky answers `404` with an
  empty body in that case, which is a normal outcome, not an upstream failure. The handler
  collapses every error into `502`, so callers can't distinguish "no track" from "OpenSky is
  down". OpenSky also documents this endpoint as experimental.
- **`/tracks` is not rate-limited or cached.** One inbound request is one upstream request, so
  it can burn OpenSky quota in a way `/states` cannot.
- **Errors are not logged.** Handlers catch and return a status without recording anything,
  which makes production failures hard to diagnose.
- **A rejected token is not retried.** The cached token is trusted until its expiry timestamp,
  so a token revoked early will fail every request until it lapses naturally.
- **No graceful shutdown.** `SIGTERM` isn't handled, so open SSE connections are cut abruptly
  on redeploy.
- **Missing OpenSky credentials aren't caught at startup**, only on the first upstream call —
  see Environment variables above.
- **No health check endpoint** for platform probes.
- **No automated tests.** `npm test` is still a placeholder.

## License

ISC
