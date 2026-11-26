/**
 * A scripted stand-in for the local Ollama runtime, so every AI decision in the e2e run is
 * deterministic and instant. The backend talks to it exactly as it talks to Ollama
 * (OLLAMA_URL=http://127.0.0.1:11435), so the real OllamaClient, parsing and fallbacks run.
 *
 * Tests steer the photo classification with directives in the report description, which the
 * backend copies into the prompt:
 *
 *   [ai:low-confidence]   confidence 0.35          -> operator review (low_confidence)
 *   [ai:not-infra]        is_infrastructure false  -> operator review (not_infrastructure)
 *   [ai:offline]          HTTP 500 from every model -> review with model "unavailable"
 *   [ai:severity=5]       severity 1-5 (default 3)
 *   [ai:type=pothole]     detected problem type (default: whatever the resident chose)
 *
 * Duplicate checks match only when both photos are byte-identical, so a test creates a
 * duplicate by uploading the same image twice. Repair checks always answer "repaired".
 * Notification rewrites echo the factual template, so message text is predictable.
 *
 *   GET  /__mock/calls   -> every call so far ({kind, model, directives})
 *   POST /__mock/reset   -> clear the call log
 */
import http from 'node:http'

const PORT = Number(process.env.MOCK_OLLAMA_PORT ?? 11435)
const MODELS = (process.env.MOCK_OLLAMA_MODELS ?? 'mock-vision,mock-fallback').split(',')

const calls = []

function directives(text) {
  const out = {}
  for (const [, body] of text.matchAll(/\[ai:([^\]]+)\]/g)) {
    const [key, value] = body.split('=')
    out[key.trim()] = value === undefined ? true : value.trim()
  }
  return out
}

function kindOf(prompt) {
  if (prompt.includes('You inspect photos')) return 'classify'
  if (prompt.includes('Two residents reported')) return 'compare'
  if (prompt.includes('A repair crew says')) return 'verify'
  if (prompt.includes('Rewrite this city repair-service update')) return 'rewrite'
  return 'other'
}

function answer(kind, prompt, images) {
  if (kind === 'classify') {
    const chosen = /chose the category "([^"]+)"/.exec(prompt)?.[1] ?? 'other'
    const text = /wrote: "([\s\S]*)"\s*Reply with JSON only/.exec(prompt)?.[1] ?? ''
    const d = directives(text)
    if (d.offline) return { status: 500, error: 'mock model offline' }
    return {
      json: {
        is_infrastructure: !d['not-infra'],
        problem_type: d.type ?? chosen,
        severity: d.severity ? Number(d.severity) : 3,
        confidence: d['low-confidence'] ? 0.35 : 0.92,
        summary: d['not-infra'] ? 'The photo does not show public infrastructure.' : `Mock assessment of a ${chosen.replace('_', ' ')}.`,
      },
      directives: d,
    }
  }
  if (kind === 'compare') {
    const same = images.length === 2 && images[0] === images[1]
    return { json: { is_match: same, confidence: same ? 0.95 : 0.9 } }
  }
  if (kind === 'verify') return { json: { verdict: 'repaired', confidence: 0.93 } }
  if (kind === 'rewrite') {
    const facts = prompt.split('Update: ').pop()?.trim() ?? ''
    return { text: facts }
  }
  return { text: 'ok' }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => (raw += chunk))
  req.on('end', () => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
    if (req.method === 'GET' && url.pathname === '/api/tags') {
      return send(res, 200, { models: MODELS.map((name) => ({ name, model: name })) })
    }
    if (req.method === 'GET' && url.pathname === '/__mock/calls') return send(res, 200, calls)
    if (req.method === 'POST' && url.pathname === '/__mock/reset') {
      calls.length = 0
      return send(res, 200, { ok: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      return send(res, 200, { model: MODELS[0], response: '', done: true })
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      let body
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        return send(res, 400, { error: 'invalid JSON' })
      }
      const message = body.messages?.[0] ?? {}
      const prompt = String(message.content ?? '')
      const images = message.images ?? []
      const kind = kindOf(prompt)
      const result = answer(kind, prompt, images)
      calls.push({ kind, model: body.model, images: images.length, directives: result.directives ?? {}, at: new Date().toISOString() })
      if (result.status) return send(res, result.status, { error: result.error })
      const content = result.json ? JSON.stringify(result.json) : result.text
      return send(res, 200, { model: body.model, message: { role: 'assistant', content }, done: true })
    }
    send(res, 404, { error: `mock-ollama: no route for ${req.method} ${url.pathname}` })
  })
})

server.listen(PORT, '127.0.0.1', () => console.log(`mock-ollama listening on http://127.0.0.1:${PORT}`))
