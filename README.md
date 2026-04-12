# @summoned/ai

TypeScript SDK for the [Summoned AI Gateway](https://github.com/summoned-tech/summoned-ai-gateway) — OpenAI-compatible client with multi-provider routing, caching, guardrails, and more.

## Install

```bash
npm install @summoned/ai
```

## Quick Start

```typescript
import { Summoned } from "@summoned/ai"

const client = new Summoned({
  apiKey: "sk-smnd-...",
  baseURL: "http://localhost:4000",  // your gateway URL
})

// Chat completion — specify provider/model
const response = await client.chat.completions.create({
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "What is the capital of France?" }],
})

console.log(response.choices[0].message.content)
console.log(response.summoned) // { provider, cost, latency_ms, ... }
```

## Streaming

```typescript
const stream = await client.chat.completions.create({
  model: "anthropic/claude-sonnet-4-20250514",
  messages: [{ role: "user", content: "Write a poem" }],
  stream: true,
})

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "")
}
```

## Config — Retries, Fallbacks, Caching, Guardrails

```typescript
const response = await client.chat.completions.create({
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
  config: {
    retry: { attempts: 3, backoff: "exponential" },
    fallback: ["anthropic/claude-sonnet-4-20250514", "groq/llama-3.3-70b-versatile"],
    timeout: 30000,
    cache: true,
    guardrails: {
      input: [{ type: "pii", deny: true }],
      output: [{ type: "contains", params: { operator: "none", words: ["confidential"] }, deny: true }],
    },
  },
})
```

## `withConfig` — Reusable Client Configuration

```typescript
const cachedClient = client.withConfig({ cache: true, cacheTtl: 3600 })

// All requests through cachedClient use caching
await cachedClient.chat.completions.create({ model: "openai/gpt-4o", messages: [...] })
```

## Use with OpenAI's SDK

If you prefer the official OpenAI SDK, use `createHeaders` to route through the gateway:

```typescript
import OpenAI from "openai"
import { createHeaders } from "@summoned/ai"

const openai = new OpenAI({
  baseURL: "http://localhost:4000/v1",
  apiKey: "sk-smnd-...",
  defaultHeaders: createHeaders({
    config: { cache: true, fallback: ["groq/llama-3.3-70b-versatile"] },
  }),
})

// Uses Summoned gateway with all its features
const res = await openai.chat.completions.create({
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
})
```

## Embeddings

```typescript
const embeddings = await client.embeddings.create({
  model: "openai/text-embedding-3-small",
  input: "The quick brown fox",
})
```

## Admin API

```typescript
const admin = new Summoned({
  apiKey: "sk-smnd-...",
  adminKey: "your-admin-key",
})

// API keys
const key = await admin.admin.keys.create({ name: "production", tenantId: "tenant_1" })
const keys = await admin.admin.keys.list("tenant_1")
await admin.admin.keys.revoke("key_abc")

// Virtual keys (encrypted provider credentials)
const vk = await admin.admin.virtualKeys.create({
  name: "my-openai-key",
  tenantId: "tenant_1",
  providerId: "openai",
  apiKey: "sk-real-openai-key-...",
})

// Logs & stats
const logs = await admin.admin.logs.list({ limit: 50 })
const stats = await admin.admin.stats.get("24h")
const providers = await admin.admin.providers.list()
```

## Debug Mode

```typescript
const client = new Summoned({
  apiKey: "sk-smnd-...",
  debug: true, // prints request/response details to console
})
```

## Response Headers

Every request populates `lastResponseHeaders`:

```typescript
await client.chat.completions.create({ model: "openai/gpt-4o", messages: [...] })

console.log(client.lastResponseHeaders)
// { provider: "openai", cache: "MISS", latencyMs: "432", costUsd: "0.000150", traceId: "..." }
```

## Error Handling

```typescript
import { SummonedError } from "@summoned/ai"

try {
  await client.chat.completions.create({ model: "openai/gpt-4o", messages: [...] })
} catch (err) {
  if (err instanceof SummonedError) {
    console.log(err.status)   // 429
    console.log(err.code)     // "RATE_LIMITED"
    console.log(err.headers)  // response headers
  }
}
```
