import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

function readStubPort(env = process.env) {
  return Number.parseInt(env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT ?? '9040', 10);
}

function resolveRequestUrl(requestUrl, serviceBaseUrl = baseUrl) {
  return new URL(requestUrl ?? '/', serviceBaseUrl);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function resolveResponseModel(body) {
  return typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : 'fixture-analysis-stub';
}

function closeListeningServer(listener) {
  return new Promise((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve(undefined)));
  });
}

const port = readStubPort();
const baseUrl = `http://127.0.0.1:${port}`;
let shutdownHandler = null;

function firstSentence(text) {
  const normalized = `${text ?? ''}`.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  const match = normalized.match(/^[\s\S]*?[.!?](?:\s|$)/);
  return (match?.[0] ?? normalized).trim();
}

function readMessageText(messages) {
  if (!Array.isArray(messages)) {
    return '';
  }
  return messages
    .flatMap((message) => {
      const content = message?.content;
      if (typeof content === 'string') {
        return [content];
      }
      if (Array.isArray(content)) {
        return content
          .map((part) => typeof part?.text === 'string' ? part.text : '')
          .filter(Boolean);
      }
      return [];
    })
    .join('\n');
}

function readTaggedLine(prompt, label) {
  const match = prompt.match(new RegExp(`^${label}:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() ?? '';
}

function readArticleBody(prompt) {
  const match = prompt.match(/ARTICLE BODY:\s*([\s\S]+)/i);
  const body = match?.[1]?.trim() ?? '';
  return /unavailable; analyze available metadata only\./i.test(body) ? '' : body;
}

export function buildFixtureAnalysis(prompt) {
  const articleTitle = readTaggedLine(prompt, 'Article title');
  const storyHeadline = readTaggedLine(prompt, 'Story headline');
  const bodySentence = firstSentence(readArticleBody(prompt));
  const summary = bodySentence || articleTitle || storyHeadline || 'Fixture analysis summary.';
  const frame = storyHeadline || articleTitle || 'Core event frame';
  return {
    summary,
    bias_claim_quote: [articleTitle || storyHeadline || 'Primary report emphasis'],
    justify_bias_claim: ['Deterministic fixture relay response for browser gate validation.'],
    biases: ['Urgency framing'],
    counterpoints: ['Additional sourcing may widen context.'],
    sentimentScore: 0.1,
    confidence: 0.92,
    perspectives: [{ frame, reframe: 'Context and verification around the same event.' }],
  };
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  const url = resolveRequestUrl(req.url, baseUrl);
  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
    sendJson(res, 404, { error: 'not-found' });
    return;
  }

  const body = await readJsonBody(req);
  const model = resolveResponseModel(body);
  const prompt = readMessageText(body?.messages);
  const content = JSON.stringify(buildFixtureAnalysis(prompt));
  sendJson(res, 200, {
    id: 'chatcmpl-fixture-analysis',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  });
});

export function startFixtureAnalysisStub() {
  if (server.listening) {
    return server;
  }

  removeShutdownHandler();
  server.listen(port, '127.0.0.1', () => {
    console.log(`[vh:e2e-analysis-stub] listening on ${baseUrl}`);
  });

  shutdownHandler = () => {
    removeShutdownHandler();
    if (!server.listening) {
      process.exit(0);
      return;
    }
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdownHandler);
  process.on('SIGTERM', shutdownHandler);
  return server;
}

export async function stopFixtureAnalysisStub() {
  removeShutdownHandler();
  if (!server.listening) {
    return;
  }
  await closeListeningServer(server);
}

function removeShutdownHandler() {
  if (!shutdownHandler) {
    return;
  }
  process.off('SIGINT', shutdownHandler);
  process.off('SIGTERM', shutdownHandler);
  shutdownHandler = null;
}

export const fixtureAnalysisStubInternal = {
  baseUrl,
  readMessageText,
  readTaggedLine,
  readArticleBody,
  firstSentence,
  readStubPort,
  resolveRequestUrl,
  readJsonBody,
  resolveResponseModel,
  closeListeningServer,
  removeShutdownHandler,
};

export function startFixtureAnalysisStubWhenLaunchedDirectly(
  argv1 = process.argv[1],
  moduleUrl = import.meta.url,
) {
  const launchedDirectly = Boolean(argv1) && moduleUrl === pathToFileURL(argv1).href;
  if (launchedDirectly) {
    startFixtureAnalysisStub();
  }
  return launchedDirectly;
}

startFixtureAnalysisStubWhenLaunchedDirectly();
