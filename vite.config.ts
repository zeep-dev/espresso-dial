import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only middleware so `/api/claude` works in the Vite dev/preview server.
// In production, Vercel serves api/claude.ts as an edge function automatically.
function devApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'dev-api-claude',
    configureServer(server) {
      server.middlewares.use('/api/claude', async (req, res) => {
        try {
          // Make ANTHROPIC_API_KEY available to the handler in dev.
          if (!process.env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY) {
            process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
          }

          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const body = Buffer.concat(chunks).toString('utf8')

          const request = new Request('http://localhost' + req.url, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          })

          const mod = await server.ssrLoadModule('/api/claude.ts')
          const handler = mod.default as (r: Request) => Promise<Response>
          const response = await handler(request)

          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(await response.text())
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load all env vars (including non-VITE_ ones like ANTHROPIC_API_KEY) for dev middleware.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), devApiPlugin(env)],
    // Allow the hosted sandbox/preview domains to reach the dev server.
    server: { allowedHosts: ['.vercel.run', '.vusercontent.net'] },
    // Expose both VITE_* vars and the SUPABASE_ANON_KEY var to client code.
    envPrefix: ['VITE_', 'SUPABASE_ANON_KEY'],
  }
})
