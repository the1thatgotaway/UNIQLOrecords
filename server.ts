import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const GEMINI_MODEL = 'gemini-4-hydrogen';

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function parseUpstreamError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const redacted = raw.replace(/AIza[0-9A-Za-z\-_]{10,}/g, '[REDACTED]');

  try {
    const parsed = JSON.parse(redacted) as { error?: { code?: number; message?: string; status?: string } };
    if (parsed?.error?.message) {
      return {
        status: typeof parsed.error.code === 'number' ? parsed.error.code : 500,
        message: parsed.error.message.slice(0, 260),
      };
    }
  } catch {
    // raw text fallback
  }

  const isUnavailable = /503|UNAVAILABLE|high demand|429|RESOURCE_EXHAUSTED/i.test(redacted);
  return {
    status: isUnavailable ? 503 : 500,
    message: redacted.slice(0, 260),
  };
}

async function withTransientRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err ?? '');
      const transient = /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(msg);
      if (!transient || attempt === maxRetries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
    }
  }
  throw lastError;
}

interface IncomingChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_INSTRUCTION = `You are a senior retail sales intelligence analyst embedded inside the UNIQLO Sales Management Records platform.
Rules you MUST strictly follow:
1. Ground every numeric claim, SKU, store code, employee ID, customer name, promotion code, and date strictly in the JSON context provided by the user's dashboard view.
2. Never invent transactions, profit margins, costs, inventory levels, or metrics not present in the context. If something is missing from the context, state clearly what is unavailable.
3. Explicitly note when interpreting time-based trends that dates in this UNIQLO snapshot (Jan 1, 2024 – Sep 26, 2026) include repaired/simulated dates from the companion SQL pipeline, so temporal spikes reflect statistical patterns in the snapshot rather than guaranteed historical store events.
4. Keep currency formatted in Philippine Pesos (₱) matching the dashboard's en-PH convention.
5. Be concise, operational, and actionable for retail analysts and store managers.`;

function validateContextPayload(context: unknown): string {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error('Missing or invalid sales context payload.');
  }
  const serialized = JSON.stringify(context);
  if (serialized.length > 48000) {
    throw new Error('Sales context payload exceeds maximum allowed size.');
  }
  return serialized;
}

const app = express();
app.use(express.json({ limit: '512kb' }));

app.get('/api/health', (_req, res) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  res.json({
    ok: true,
    model: GEMINI_MODEL,
    keyConfigured: Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY'),
  });
});

app.post('/api/llm/analyze', async (req, res) => {
  const ai = getGenAIClient();
  if (!ai) {
    res.status(503).json({
      error:
        'GEMINI_API_KEY is not configured in the server environment. Set it in AI Studio Secrets to enable live Gemini analysis.',
    });
    return;
  }

  try {
    const body = req.body as { task?: unknown; context?: unknown };
    const task = typeof body?.task === 'string' ? body.task : 'executive-briefing';
    if (!['executive-briefing', 'anomaly-explanation', 'scenario-deep-dive'].includes(task)) {
      res.status(400).json({ error: 'Unsupported analysis task requested.' });
      return;
    }

    const contextJson = validateContextPayload(body.context);
    const taskInstructions: Record<string, string> = {
      'executive-briefing':
        'Produce a crisp executive briefing covering revenue concentration, top SKUs/stores/promos, and immediate operational takeaways.',
      'anomaly-explanation':
        'Focus specifically on the IQR statistical anomalies, data-integrity flags, and Isolation Forest graph outliers. Explain what makes them stand out and how an analyst should audit them.',
      'scenario-deep-dive':
        'Analyze this specific scenario slice, pricing/quantity dynamics, customer/store patterns, and comparison opportunities.',
    };

    const prompt = `Task: ${taskInstructions[task]}

Active Dashboard Context (JSON):
${contextJson}`;

    const response = await withTransientRetry(() =>
      ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: {
                type: Type.STRING,
                description: 'Concise 1-line analytical headline summarizing the filtered slice.',
              },
              executiveSummary: {
                type: Type.STRING,
                description: '2-3 sentence grounded synthesis citing exact ₱ totals and counts.',
              },
              keyDrivers: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 to 4 crisp bullet points on top products, stores, promos, or trends.',
              },
              anomalyAssessment: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  '2 to 3 bullet points interpreting IQR flags and Isolation Forest graph anomalies.',
              },
              recommendedActions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2 to 3 concrete operational or SQL audit follow-up steps.',
              },
              dataCaveat: {
                type: Type.STRING,
                description:
                  'Short note clarifying scope (filtered count) and simulated date caveat.',
              },
            },
            required: [
              'headline',
              'executiveSummary',
              'keyDrivers',
              'anomalyAssessment',
              'recommendedActions',
              'dataCaveat',
            ],
          },
        },
      })
    );

    const rawText = response.text?.trim();
    if (!rawText) {
      res.status(502).json({ error: 'Gemini returned an empty response.' });
      return;
    }

    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    res.json({
      ...parsed,
      model: GEMINI_MODEL,
    });
  } catch (err) {
    console.error('Error in /api/llm/analyze:', err);
    const { status, message } = parseUpstreamError(err);
    res.status(status).json({ error: message });
  }
});

app.post('/api/llm/chat', async (req, res) => {
  const ai = getGenAIClient();
  if (!ai) {
    res.status(503).json({
      error:
        'GEMINI_API_KEY is not configured in the server environment. Set it in AI Studio Secrets to enable live Gemini chat.',
    });
    return;
  }

  let contextJson: string;
  let question: string;
  let history: IncomingChatTurn[] = [];

  try {
    const body = req.body as { question?: unknown; history?: unknown; context?: unknown };
    if (typeof body?.question !== 'string' || !body.question.trim()) {
      res.status(400).json({ error: 'Question must be a non-empty string.' });
      return;
    }
    question = body.question.trim();
    if (question.length > 2000) {
      res.status(400).json({ error: 'Question must be 2,000 characters or fewer.' });
      return;
    }

    contextJson = validateContextPayload(body.context);

    if (Array.isArray(body.history)) {
      history = body.history
        .slice(-12)
        .filter(
          (item): item is IncomingChatTurn =>
            Boolean(item) &&
            typeof item === 'object' &&
            (item.role === 'user' || item.role === 'assistant') &&
            typeof item.content === 'string' &&
            item.content.trim().length > 0
        )
        .map((item) => ({
          role: item.role,
          content: item.content.slice(0, 4000),
        }));
    }
  } catch (err) {
    const { message } = parseUpstreamError(err);
    res.status(400).json({ error: message });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  try {
    const chatContents = [
      {
        role: 'user',
        parts: [
          {
            text: `Here is the live grounded summary of the active UNIQLO dashboard slice you must use to answer all questions:\n${contextJson}`,
          },
        ],
      },
      {
        role: 'model',
        parts: [
          {
            text: 'Understood. I have loaded the grounded UNIQLO KPIs, product/store/promo rankings, period trends, anomaly flags, and top sample transactions for this active view.',
          },
        ],
      },
      ...history.map((turn) => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: turn.content }],
      })),
      {
        role: 'user',
        parts: [{ text: question }],
      },
    ];

    const stream = await withTransientRetry(() =>
      ai.models.generateContentStream({
        model: GEMINI_MODEL,
        contents: chatContents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      })
    );

    for await (const chunk of stream) {
      const delta = chunk.text;
      if (delta) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Error in /api/llm/chat:', err);
    const { message } = parseUpstreamError(err);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`UNIQLO Sales Analytics server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
