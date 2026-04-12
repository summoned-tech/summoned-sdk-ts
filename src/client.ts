import type {
  SummonedConfig,
  RequestConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ProvidersListResponse,
  CreateKeyRequest,
  ApiKeyResponse,
  CreateVirtualKeyRequest,
  VirtualKeyResponse,
  LogEntry,
  StatsResponse,
  ProviderHealthInfo,
  ResponseHeaders,
} from "./types"

const DEFAULT_BASE_URL = "http://localhost:4000"
const SDK_VERSION = "0.1.0"

// ---------------------------------------------------------------------------
// createHeaders — for users who want to use OpenAI's SDK but route via Summoned
// ---------------------------------------------------------------------------

/**
 * Generate HTTP headers to route an OpenAI SDK request through the Summoned gateway.
 *
 * ```typescript
 * import OpenAI from "openai"
 * import { createHeaders } from "@summoned/ai"
 *
 * const openai = new OpenAI({
 *   baseURL: "http://localhost:4000/v1",
 *   apiKey: "sk-smnd-...",
 *   defaultHeaders: createHeaders({ config: { cache: true } }),
 * })
 * ```
 */
export function createHeaders(opts?: {
  config?: RequestConfig
  traceId?: string
  metadata?: Record<string, string>
}): Record<string, string> {
  const headers: Record<string, string> = {
    "x-summoned-sdk": `ts-${SDK_VERSION}`,
  }
  const config: RequestConfig = { ...opts?.config }
  if (opts?.traceId) config.traceId = opts.traceId
  if (opts?.metadata) config.metadata = opts.metadata
  if (Object.keys(config).length > 0) {
    headers["x-summoned-config"] = btoa(JSON.stringify(config))
  }
  return headers
}

// ---------------------------------------------------------------------------
// Main client
// ---------------------------------------------------------------------------

export class Summoned {
  private apiKey: string
  private baseURL: string
  private timeout: number
  private maxRetries: number
  private debug: boolean
  private adminKey: string | undefined
  private defaultConfig: RequestConfig | undefined
  private _responseHeaders: ResponseHeaders = {}

  chat: ChatAPI
  embeddings: EmbeddingsAPI
  models: ModelsAPI
  admin: AdminAPI

  constructor(opts: SummonedConfig) {
    if (!opts.apiKey) throw new Error("Summoned: apiKey is required")
    this.apiKey = opts.apiKey
    this.baseURL = (opts.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, "")
    this.timeout = opts.timeout ?? 120_000
    this.maxRetries = opts.maxRetries ?? 2
    this.debug = opts.debug ?? false
    this.adminKey = opts.adminKey

    this.chat = new ChatAPI(this)
    this.embeddings = new EmbeddingsAPI(this)
    this.models = new ModelsAPI(this)
    this.admin = new AdminAPI(this)
  }

  /** Create a new client with merged config — like Portkey's `client.with_options(config=...)` */
  withConfig(config: RequestConfig): Summoned {
    const clone = Object.create(this) as Summoned
    clone.defaultConfig = { ...this.defaultConfig, ...config }
    clone.chat = new ChatAPI(clone)
    clone.embeddings = new EmbeddingsAPI(clone)
    clone.models = new ModelsAPI(clone)
    clone.admin = new AdminAPI(clone)
    return clone
  }

  /** Response headers from the last request */
  get lastResponseHeaders(): ResponseHeaders {
    return this._responseHeaders
  }

  // -------------------------------------------------------------------------
  // Internal HTTP helpers
  // -------------------------------------------------------------------------

  /** @internal */
  async _request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { config?: RequestConfig; useAdminAuth?: boolean },
  ): Promise<T> {
    const mergedConfig = this.defaultConfig || opts?.config
      ? { ...this.defaultConfig, ...opts?.config }
      : undefined

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-summoned-sdk": `ts-${SDK_VERSION}`,
    }

    if (opts?.useAdminAuth) {
      if (!this.adminKey) throw new Error("Summoned: adminKey is required for admin operations")
      headers["x-admin-key"] = this.adminKey
    } else {
      headers["Authorization"] = `Bearer ${this.apiKey}`
    }

    if (mergedConfig) {
      headers["x-summoned-config"] = btoa(JSON.stringify(mergedConfig))
    }

    let lastError: unknown

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(500 * Math.pow(2, attempt - 1), 5000)
        if (this.debug) console.log(`[summoned] retry ${attempt}/${this.maxRetries} after ${delay}ms`)
        await new Promise((r) => setTimeout(r, delay))
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeout)

      try {
        if (this.debug) console.log(`[summoned] ${method} ${this.baseURL}${path}`, body ? JSON.stringify(body).slice(0, 200) : "")

        const response = await fetch(`${this.baseURL}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })

        clearTimeout(timer)
        this._responseHeaders = parseResponseHeaders(response.headers)

        if (this.debug) {
          console.log(`[summoned] ${response.status} | provider=${this._responseHeaders.provider ?? "?"} cache=${this._responseHeaders.cache ?? "?"} latency=${this._responseHeaders.latencyMs ?? "?"}ms`)
        }

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({ error: { message: response.statusText } })) as any
          const err = new SummonedError(
            errBody?.error?.message ?? response.statusText,
            response.status,
            errBody?.error?.code,
            this._responseHeaders,
          )
          if (response.status >= 500 && attempt < this.maxRetries) {
            lastError = err
            continue
          }
          throw err
        }

        return await response.json() as T
      } catch (err) {
        clearTimeout(timer)
        if (err instanceof SummonedError) throw err
        lastError = err
        if (attempt === this.maxRetries) break
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  /** @internal — streaming SSE request */
  async *_stream(path: string, body: unknown, config?: RequestConfig): AsyncGenerator<ChatCompletionChunk> {
    const mergedConfig = this.defaultConfig || config
      ? { ...this.defaultConfig, ...config }
      : undefined

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      "x-summoned-sdk": `ts-${SDK_VERSION}`,
    }
    if (mergedConfig) {
      headers["x-summoned-config"] = btoa(JSON.stringify(mergedConfig))
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(`${this.baseURL}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      this._responseHeaders = parseResponseHeaders(response.headers)

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: { message: response.statusText } })) as any
        throw new SummonedError(errBody?.error?.message ?? response.statusText, response.status, errBody?.error?.code, this._responseHeaders)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response body")

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith("data: ")) continue
          const data = trimmed.slice(6)
          if (data === "[DONE]") return
          try { yield JSON.parse(data) as ChatCompletionChunk } catch { /* skip */ }
        }
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

// ---------------------------------------------------------------------------
// API namespaces
// ---------------------------------------------------------------------------

class ChatAPI {
  completions: CompletionsAPI
  constructor(client: Summoned) { this.completions = new CompletionsAPI(client) }
}

class CompletionsAPI {
  constructor(private client: Summoned) {}

  async create(params: ChatCompletionRequest & { stream?: false }): Promise<ChatCompletionResponse>
  async create(params: ChatCompletionRequest & { stream: true }): Promise<AsyncGenerator<ChatCompletionChunk>>
  async create(params: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk>>
  async create(params: ChatCompletionRequest): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk>> {
    const { config, ...rest } = params
    if (params.stream) return this.client._stream("/v1/chat/completions", rest, config)
    return this.client._request<ChatCompletionResponse>("POST", "/v1/chat/completions", rest, { config })
  }
}

class EmbeddingsAPI {
  constructor(private client: Summoned) {}

  async create(params: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.client._request<EmbeddingResponse>("POST", "/v1/embeddings", params)
  }
}

class ModelsAPI {
  constructor(private client: Summoned) {}

  /** List registered providers (the gateway is a pure proxy — no static model catalog) */
  async list(): Promise<ProvidersListResponse> {
    return this.client._request<ProvidersListResponse>("GET", "/v1/models")
  }
}

// ---------------------------------------------------------------------------
// Admin API — requires adminKey
// ---------------------------------------------------------------------------

class AdminAPI {
  keys: AdminKeysAPI
  virtualKeys: AdminVirtualKeysAPI
  logs: AdminLogsAPI
  stats: AdminStatsAPI
  providers: AdminProvidersAPI

  constructor(client: Summoned) {
    this.keys = new AdminKeysAPI(client)
    this.virtualKeys = new AdminVirtualKeysAPI(client)
    this.logs = new AdminLogsAPI(client)
    this.stats = new AdminStatsAPI(client)
    this.providers = new AdminProvidersAPI(client)
  }
}

class AdminKeysAPI {
  constructor(private client: Summoned) {}

  async create(params: CreateKeyRequest): Promise<ApiKeyResponse> {
    return this.client._request<ApiKeyResponse>("POST", "/v1/keys", params, { useAdminAuth: true })
  }

  async list(tenantId: string): Promise<{ keys: ApiKeyResponse[] }> {
    return this.client._request("GET", `/v1/keys?tenantId=${encodeURIComponent(tenantId)}`, undefined, { useAdminAuth: true })
  }

  async revoke(id: string): Promise<{ id: string; revoked: boolean }> {
    return this.client._request("DELETE", `/v1/keys/${encodeURIComponent(id)}`, undefined, { useAdminAuth: true })
  }
}

class AdminVirtualKeysAPI {
  constructor(private client: Summoned) {}

  async create(params: CreateVirtualKeyRequest): Promise<VirtualKeyResponse> {
    return this.client._request<VirtualKeyResponse>("POST", "/admin/virtual-keys", params, { useAdminAuth: true })
  }

  async list(tenantId: string): Promise<{ data: VirtualKeyResponse[] }> {
    return this.client._request("GET", `/admin/virtual-keys?tenantId=${encodeURIComponent(tenantId)}`, undefined, { useAdminAuth: true })
  }

  async revoke(id: string): Promise<{ id: string; revoked: boolean }> {
    return this.client._request("DELETE", `/admin/virtual-keys/${encodeURIComponent(id)}`, undefined, { useAdminAuth: true })
  }
}

class AdminLogsAPI {
  constructor(private client: Summoned) {}

  async list(opts?: { limit?: number; source?: "buffer" | "database"; tenantId?: string; status?: string; from?: string; to?: string }): Promise<{ data: LogEntry[]; source: string }> {
    const params = new URLSearchParams()
    if (opts?.limit) params.set("limit", String(opts.limit))
    if (opts?.source) params.set("source", opts.source)
    if (opts?.tenantId) params.set("tenantId", opts.tenantId)
    if (opts?.status) params.set("status", opts.status)
    if (opts?.from) params.set("from", opts.from)
    if (opts?.to) params.set("to", opts.to)
    const qs = params.toString()
    return this.client._request("GET", `/admin/logs${qs ? `?${qs}` : ""}`, undefined, { useAdminAuth: true })
  }
}

class AdminStatsAPI {
  constructor(private client: Summoned) {}

  async get(period?: "24h" | "7d" | "30d"): Promise<StatsResponse> {
    const qs = period ? `?period=${period}` : ""
    return this.client._request("GET", `/admin/stats${qs}`, undefined, { useAdminAuth: true })
  }
}

class AdminProvidersAPI {
  constructor(private client: Summoned) {}

  async list(): Promise<{ data: ProviderHealthInfo[] }> {
    return this.client._request("GET", "/admin/providers", undefined, { useAdminAuth: true })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResponseHeaders(headers: Headers): ResponseHeaders {
  return {
    provider: headers.get("x-summoned-provider") ?? undefined,
    servedBy: headers.get("x-summoned-served-by") ?? undefined,
    costUsd: headers.get("x-summoned-cost-usd") ?? undefined,
    latencyMs: headers.get("x-summoned-latency-ms") ?? undefined,
    traceId: headers.get("x-summoned-trace-id") ?? undefined,
    cache: headers.get("x-summoned-cache") ?? undefined,
    rateLimitLimit: headers.get("x-ratelimit-limit") ?? undefined,
    rateLimitRemaining: headers.get("x-ratelimit-remaining") ?? undefined,
  }
}

export class SummonedError extends Error {
  status: number
  code: string | undefined
  headers: ResponseHeaders

  constructor(message: string, status: number, code?: string, headers?: ResponseHeaders) {
    super(message)
    this.name = "SummonedError"
    this.status = status
    this.code = code
    this.headers = headers ?? {}
  }
}
