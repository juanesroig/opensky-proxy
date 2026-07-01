import express from "express"

type ClientUUID = string
type ResObjectByClientUUID = Map<ClientUUID, express.Response>
type AsyncFetcher<T> = () => Promise<T>

const MAX_DATA_AGE_MS = 60_000

export class BroadcastPoller<T> {
  private get_data: AsyncFetcher<T>
  private time_ms: number
  private clients: ResObjectByClientUUID = new Map()
  private interval_id: NodeJS.Timeout | null = null
  private latest_data: T | null = null
  private latest_data_at: number | null = null
  private is_fetching = false

  constructor(get_data: AsyncFetcher<T>, time_ms = 15_000) {
    this.get_data = get_data
    this.time_ms = time_ms
  }

  private write_sse(res: express.Response, event: string, data: unknown) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  private error_message(error: unknown) {
    if (error instanceof Error) {
      return error.message
    }
    if (typeof error === "string") {
      return error
    }
    return "Unknown polling error"
  }

  private async dispatcher() {
    if (this.is_fetching) {
      return
    }

    this.is_fetching = true

    try {
      const data = await this.get_data()
      this.latest_data = data
      this.latest_data_at = Date.now()
      for (const res of this.clients.values()) {
        this.write_sse(res, "success", data)
      }
    } catch (error) {
      const message = this.error_message(error)
      for (const res of this.clients.values()) {
        this.write_sse(res, "error", { message })
      }
    } finally {
      this.is_fetching = false
    }
  }

  register(res: express.Response) {
    const client_uuid = crypto.randomUUID()
    this.clients.set(client_uuid, res)

    const is_stale =
      this.latest_data_at === null ||
      Date.now() - this.latest_data_at > MAX_DATA_AGE_MS

    if (is_stale) {
      this.latest_data = null
      this.latest_data_at = null
    }

    if (this.latest_data !== null) {
      this.write_sse(res, "success", this.latest_data)
    }

    if (this.interval_id === null) {
      void this.dispatcher()
      this.interval_id = setInterval(() => {
        void this.dispatcher()
      }, this.time_ms)
    }

    return client_uuid
  }

  unregister(client_uuid: ClientUUID) {
    this.clients.delete(client_uuid)
    if (this.clients.size === 0 && this.interval_id !== null) {
      clearInterval(this.interval_id)
      this.interval_id = null
    }
  }
}
