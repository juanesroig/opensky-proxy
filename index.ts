import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import { type Auth, type TokenPayload } from './types.js'
import { BroadcastPoller } from './polling.js'

const app = express()

const opensky_urls = {
  STATES: "https://opensky-network.org/api/states/all",
  TRACKS: "https://opensky-network.org/api/tracks/all",
}
const token_url = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
const opensky_client_id = process.env.OPENSKY_CLIENT_ID
const opensky_client_secret = process.env.OPENSKY_CLIENT_SECRET
const states_poll_interval_ms = 15_000
const opensky_fetch_timeout_ms = 20_000
const port = Number(process.env.PORT)

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('Missing or invalid PORT in env')
}

const cors_origins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

if (cors_origins.length === 0) {
  throw new Error('Missing CORS_ORIGIN in env (comma-separated list of allowed origins)')
}

app.use(cors({
  origin: cors_origins,
  credentials: false,
}))

app.listen(port, () => {
  console.log(`OpenSky Proxy running on port ${port}`)
})

let auth: Auth | undefined = undefined

const parse_token_payload = (payload: unknown): TokenPayload => {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Auth response was not a JSON object")
  }

  const { access_token, expires_in } = payload as Partial<TokenPayload>

  if (typeof access_token !== "string" || access_token.length === 0) {
    throw new Error("Auth response missing access_token")
  }

  if (typeof expires_in !== "number" || !Number.isFinite(expires_in)) {
    throw new Error("Auth response missing expires_in")
  }

  return { ...(payload as TokenPayload), access_token, expires_in }
}

const ensure_auth_token = async () => {
  if (!opensky_client_id || !opensky_client_secret) {
    console.error("Missing OpenSky credentials in env")
    throw new Error("Missing OpenSky credentials in env")
  }

  const now = Date.now()
  if (auth !== undefined && now < auth.expires_at) {
    return
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: opensky_client_id,
    client_secret: opensky_client_secret,
  })

  const started_at = performance.now()

  try {
    const response = await fetch(token_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(opensky_fetch_timeout_ms),
    })

    const body = await response.text()
    const elapsed_ms = Math.round(performance.now() - started_at)

    if (!response.ok) {
      console.error(`[token] ${response.status} in ${elapsed_ms}ms`, body.slice(0, 300))
      throw new Error(`Auth failed with status ${response.status}`)
    }

    console.log(`[token] ${response.status} in ${elapsed_ms}ms`)

    const data = parse_token_payload(JSON.parse(body))
    auth = {
      token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
    }
  } catch (error) {
    console.error(`[token] FAIL after ${Math.round(performance.now() - started_at)}ms`, {
      name: (error as Error).name,
      message: (error as Error).message,
      cause: (error as { cause?: unknown }).cause,
    })
    throw error
  }
}

const handle_token = async (
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    await ensure_auth_token()
    return next()
  } catch (error) {
    return res.status(401).send("Error authenticating with OpenSky API")
  }
}

const fetch_states = async () => {
  await ensure_auth_token()
  const response = await fetch(opensky_urls.STATES, {
    headers: {
      Authorization: `Bearer ${auth?.token ?? ""}`,
    },
    signal: AbortSignal.timeout(opensky_fetch_timeout_ms),
  })

  if (!response.ok) {
    throw new Error(`States request failed with status ${response.status}`)
  }

  return response.json()
}

const poller = new BroadcastPoller(
  fetch_states,
  states_poll_interval_ms,
  opensky_fetch_timeout_ms
)
app.get("/api/opensky/states", handle_token, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("Connection", "keep-alive")
  res.setHeader("X-Accel-Buffering", "no")
  res.flushHeaders()

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`)

  const client_id = poller.register(res)

  req.on("close", () => {
    poller.unregister(client_id)
    res.end()
  })
})

const fetch_tracks = async (icao24: string) => {
  await ensure_auth_token()

  const params = new URLSearchParams({
    icao24,
    time: "0",
  })

  const response = await fetch(`${opensky_urls.TRACKS}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${auth?.token ?? ""}`,
    },
    signal: AbortSignal.timeout(opensky_fetch_timeout_ms),
  })

  if (!response.ok) {
    throw new Error(`Tracks request failed with status ${response.status}`)
  }

  return response.json()
}

app.get("/api/opensky/tracks/:icao24", handle_token, async (req, res) => {
  const icao24 = req.params.icao24

  if (!icao24) {
    return res.status(400).send("Missing icao24 parameter")
  }

  if (typeof icao24 !== "string") {
    return res.status(400).send("icao24 parameter must be a string")
  }

  try {
    const tracks = await fetch_tracks(icao24)
    return res.json(tracks)
  } catch (error) {
    return res.status(502).send("Error fetching tracks from OpenSky API")
  }
})
