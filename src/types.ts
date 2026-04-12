// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export interface SummonedConfig {
  apiKey: string
  baseURL?: string
  timeout?: number
  /** Client-side retries for network errors (not LLM retries — those happen on the gateway) */
  maxRetries?: number
  /** Print request/response details to console */
  debug?: boolean
  /** Admin API key for key management and logs endpoints */
  adminKey?: string
}

/** Per-request gateway config (sent via x-summoned-config header) */
export interface RequestConfig {
  retry?: { attempts?: number; backoff?: "exponential" | "linear"; initialDelayMs?: number }
  timeout?: number
  fallback?: string[]
  routing?: "default" | "cost" | "latency"
  cache?: boolean
  cacheTtl?: number
  virtualKey?: string
  metadata?: Record<string, string>
  traceId?: string
  guardrails?: { input?: Guardrail[]; output?: Guardrail[] }
}

export interface Guardrail {
  type: "contains" | "regex" | "length" | "pii"
  params?: Record<string, unknown>
  deny?: boolean
}

// ---------------------------------------------------------------------------
// Chat Completions
// ---------------------------------------------------------------------------

export interface ChatCompletionRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  tools?: Tool[]
  tool_choice?: unknown
  top_p?: number
  stop?: string | string[]
  fallback_models?: string[]
  config?: RequestConfig
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string | ContentPart[]
  tool_call_id?: string
  tool_calls?: ToolCall[]
  name?: string
}

export interface ContentPart {
  type: string
  text?: string
  image_url?: { url: string }
}

export interface Tool {
  type: "function"
  function: { name: string; description?: string; parameters?: unknown }
}

export interface ToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: ChatChoice[]
  usage: Usage
  summoned?: SummonedMeta
}

export interface ChatChoice {
  index: number
  message: ChatMessage
  finish_reason: string
}

export interface Usage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface SummonedMeta {
  provider: string
  served_by: string
  resolved_model: string
  fallback_attempts?: { modelAlias: string; error: string }[]
  retries?: number
  cost?: { costUsd: number; costInr: number; inputCostUsd: number; outputCostUsd: number }
  latency_ms?: number
  cache?: boolean
}

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: { index: number; delta: Partial<ChatMessage>; finish_reason: string | null }[]
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export interface EmbeddingRequest {
  model: string
  input: string | string[]
  encoding_format?: "float" | "base64"
}

export interface EmbeddingResponse {
  object: "list"
  data: { object: "embedding"; index: number; embedding: number[] }[]
  model: string
  usage: { prompt_tokens: number; total_tokens: number }
  summoned?: { provider: string; resolved_model: string; cost: SummonedMeta["cost"]; latency_ms: number }
}

// ---------------------------------------------------------------------------
// Models / Providers
// ---------------------------------------------------------------------------

export interface ProviderInfo {
  id: string
  object: "provider"
  name: string
  supportsEmbeddings: boolean
  usage: string
}

export interface ProvidersListResponse {
  object: "list"
  data: ProviderInfo[]
  hint: string
}

// ---------------------------------------------------------------------------
// Admin: API Keys
// ---------------------------------------------------------------------------

export interface CreateKeyRequest {
  name: string
  tenantId: string
  rateLimitRpm?: number
  rateLimitTpd?: number
}

export interface ApiKeyResponse {
  id: string
  key?: string
  name: string
  tenantId: string
  rateLimitRpm: number
  rateLimitTpd: number
  isActive?: boolean
  createdAt: string
  lastUsedAt?: string | null
}

// ---------------------------------------------------------------------------
// Admin: Virtual Keys
// ---------------------------------------------------------------------------

export interface CreateVirtualKeyRequest {
  name: string
  tenantId: string
  providerId: string
  apiKey: string
  providerConfig?: Record<string, string>
}

export interface VirtualKeyResponse {
  id: string
  name: string
  tenantId: string
  providerId: string
  providerConfig?: Record<string, string> | null
  isActive?: boolean
  createdAt: string
  lastUsedAt?: string | null
}

// ---------------------------------------------------------------------------
// Admin: Logs & Stats
// ---------------------------------------------------------------------------

export interface LogEntry {
  id: string
  timestamp: string
  provider: string
  requestedModel: string
  resolvedModel: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  streaming: boolean
  status: "success" | "error" | "rate_limited" | "auth_failed"
  costUsd: number
  costInr: number
  tenantId: string
  apiKeyId: string
  errorMessage?: string | null
}

export interface StatsResponse {
  period: string
  since: string
  requests: { total: number; success: number; errors: number; errorRate: number }
  tokens: { input: number; output: number; total: number }
  latency: { avg: number; p50: number; p95: number; p99: number }
  topModels: { model: string; provider: string; count: number; totalTokens: number }[]
  activeApiKeys: number
  providers: string[]
}

export interface ProviderHealthInfo {
  id: string
  name: string
  supportsEmbeddings: boolean
  health: { state: "closed" | "open" | "half_open"; failures: number }
}

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

export interface ResponseHeaders {
  provider?: string
  servedBy?: string
  costUsd?: string
  latencyMs?: string
  traceId?: string
  cache?: string
  rateLimitLimit?: string
  rateLimitRemaining?: string
}
