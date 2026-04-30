import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

function readStubPort(env = process.env) {
  const defaultPort = env.VITEST || env.VITEST_WORKER_ID ? '9140' : '9040';
  return Number.parseInt(env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT ?? defaultPort, 10);
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
    listener.close((error) => {
      if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') {
        resolve(undefined);
        return;
      }
      reject(error);
    });
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

function sentenceList(text) {
  const normalized = `${text ?? ''}`.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }
  const matches = normalized.match(/[^.!?]+[.!?]+/g) ?? [normalized];
  return matches.map((sentence) => sentence.trim()).filter(Boolean);
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

function readBundleHeadline(prompt) {
  return readTaggedLine(prompt, 'Headline')
    || readTaggedLine(prompt, 'Story headline')
    || 'Fixture story';
}

function readBundlePublishers(prompt) {
  const publishers = new Set();
  for (const match of prompt.matchAll(/^\s*\d+\.\s+\[([^\]]+)\]/gm)) {
    const publisher = match[1]?.trim();
    if (publisher) publishers.add(publisher);
  }
  for (const match of prompt.matchAll(/^- publisher:\s*(.+)$/gim)) {
    const publisher = match[1]?.trim();
    if (publisher) publishers.add(publisher);
  }
  return [...publishers];
}

function readArticleBody(prompt) {
  const match = prompt.match(/ARTICLE BODY:\s*([\s\S]+)/i);
  const body = match?.[1]?.trim() ?? '';
  return /unavailable; analyze available metadata only\./i.test(body) ? '' : body;
}

function normalizeWords(text) {
  const STOP_WORDS = new Set([
    'about',
    'after',
    'against',
    'american',
    'began',
    'begin',
    'between',
    'could',
    'federal',
    'government',
    'house',
    'legal',
    'plans',
    'replace',
    'screening',
    'state',
    'their',
    'there',
    'these',
    'those',
    'trump',
    'under',
    'white',
    'which',
    'while',
    'where',
    'would',
  ]);
  return `${text ?? ''}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
}

function jaccardOverlap(leftWords, rightWords) {
  const left = new Set(leftWords);
  const right = new Set(rightWords);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const word of left) {
    if (right.has(word)) {
      intersection += 1;
    }
  }
  return intersection / new Set([...left, ...right]).size;
}

function readPairLabelRequests(prompt) {
  const candidates = [`${prompt ?? ''}`]
    .concat(`${prompt ?? ''}`.split('\n').map((line) => line.trim()).filter(Boolean).reverse());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed?.pair_labels)) {
        return parsed.pair_labels;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function classifyPairLabel(pair) {
  const leftTitleWords = normalizeWords(pair?.left?.title);
  const rightTitleWords = normalizeWords(pair?.right?.title);
  const leftTextWords = normalizeWords(pair?.left?.text);
  const rightTextWords = normalizeWords(pair?.right?.text);
  const headlineWords = normalizeWords(pair?.story_headline);

  const titleOverlap = jaccardOverlap(leftTitleWords, rightTitleWords);
  const textOverlap = jaccardOverlap(leftTextWords, rightTextWords);
  const headlineLeftOverlap = jaccardOverlap(headlineWords, leftTitleWords);
  const headlineRightOverlap = jaccardOverlap(headlineWords, rightTitleWords);
  const strongestOverlap = Math.max(titleOverlap, textOverlap, headlineLeftOverlap, headlineRightOverlap);
  const identicalTitles =
    leftTitleWords.length > 0
    && leftTitleWords.join(' ') === rightTitleWords.join(' ');

  if (identicalTitles || (titleOverlap >= 0.92 && textOverlap >= 0.84)) {
    return {
      label: 'duplicate',
      confidence: 0.97,
      rationale: 'Deterministic fixture classifier found near-identical title/body overlap.',
    };
  }

  if (titleOverlap >= 0.2 || textOverlap >= 0.14 || strongestOverlap >= 0.4) {
    return {
      label: 'same_incident',
      confidence: 0.93,
      rationale: 'Deterministic fixture classifier found strong shared incident language across the paired reports.',
    };
  }

  if (
    (titleOverlap >= 0.12 || textOverlap >= 0.1 || strongestOverlap >= 0.28)
    && (headlineLeftOverlap >= 0.12 || headlineRightOverlap >= 0.12)
  ) {
    return {
      label: 'same_developing_episode',
      confidence: 0.82,
      rationale: 'Deterministic fixture classifier found limited but still episode-level overlap.',
    };
  }

  return {
    label: 'related_topic_only',
    confidence: 0.91,
    rationale: 'Deterministic fixture classifier found topic adjacency without enough shared incident detail.',
  };
}

export function buildFixturePairLabelResponse(prompt) {
  const pairRequests = readPairLabelRequests(prompt);
  if (!pairRequests) {
    return null;
  }

  return {
    pair_labels: pairRequests.map((pair) => ({
      pair_id: typeof pair?.pair_id === 'string' ? pair.pair_id : 'fixture-pair',
      ...classifyPairLabel(pair),
    })),
  };
}

export function buildFixtureAnalysis(prompt) {
  const articleTitle = readTaggedLine(prompt, 'Title') || readTaggedLine(prompt, 'Article title');
  const storyHeadline = readTaggedLine(prompt, 'Story headline');
  const body = readArticleBody(prompt);
  const bodyFacts = sentenceList(body).slice(0, 3);
  const fallbackFact = articleTitle || storyHeadline || 'Fixture analysis summary.';
  const keyFacts = bodyFacts.length > 0 ? bodyFacts : [fallbackFact];
  const summary = keyFacts.slice(0, 2).join(' ');
  const frameSubject = storyHeadline || articleTitle || firstSentence(summary) || 'the reported event';
  const lowerSubject = frameSubject.toLowerCase();
  return {
    key_facts: keyFacts,
    summary,
    bias_claim_quote: [keyFacts[0] ?? fallbackFact],
    justify_bias_claim: ['Deterministic fixture relay identified the article emphasis for browser gate validation.'],
    biases: [`Institutions should treat ${lowerSubject} as requiring urgent action.`],
    counterpoints: [`Institutions should wait for more verified details before escalating ${lowerSubject}.`],
    confidence: 0.92,
    perspectives: [
      {
        frame: `Public officials should act quickly on ${lowerSubject}.`,
        reframe: `Public officials should wait for verified details about ${lowerSubject}.`,
      },
      {
        frame: `Accountability should focus on the institutions involved in ${lowerSubject}.`,
        reframe: `Accountability should focus first on confirming unresolved facts about ${lowerSubject}.`,
      },
    ],
  };
}

export function buildFixtureBundleSynthesis(prompt) {
  const headline = readBundleHeadline(prompt);
  const publishers = readBundlePublishers(prompt);
  const sourcePublishers = publishers.length > 0 ? publishers : ['Fixture Source'];
  const sourceCount = Math.max(1, sourcePublishers.length);
  const subject = firstSentence(headline).replace(/[.!?]+$/, '') || 'the story';
  const lowerSubject = subject.toLowerCase();

  return {
    key_facts: [
      `${subject} is represented by ${sourceCount} eligible full-text source${sourceCount === 1 ? '' : 's'}.`,
      `The deterministic synthesis input includes ${sourcePublishers.join(', ')}.`,
    ],
    summary: `${subject} is covered by ${sourceCount} source${sourceCount === 1 ? '' : 's'} in the deterministic local analysis lane. The synthesis captures shared facts while keeping disputed implications in the frame and reframe rows.`,
    frame_reframe_table: [
      {
        frame: `Public officials should treat ${lowerSubject} as requiring fast action.`,
        reframe: `Public officials should slow decisions on ${lowerSubject} until the evidence is clearer.`,
      },
      {
        frame: `The main accountability question is whether institutions responded early enough to ${lowerSubject}.`,
        reframe: `The main accountability question is whether coverage is overstating unresolved parts of ${lowerSubject}.`,
      },
    ],
    source_count: sourceCount,
    warnings: sourceCount === 1 ? ['single-source-only'] : [],
    synthesis_ready: true,
  };
}

function isBundleSynthesisPrompt(prompt) {
  return /"source_count"/.test(prompt)
    && (
      /"frame_reframe_table"/.test(prompt)
      || /"source_publishers"/.test(prompt)
      || /"verification_confidence"/.test(prompt)
    );
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
  const content = JSON.stringify(
    buildFixturePairLabelResponse(prompt)
      ?? (isBundleSynthesisPrompt(prompt) ? buildFixtureBundleSynthesis(prompt) : null)
      ?? buildFixtureAnalysis(prompt),
  );
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
  readBundleHeadline,
  readBundlePublishers,
  readArticleBody,
  firstSentence,
  sentenceList,
  readStubPort,
  resolveRequestUrl,
  readJsonBody,
  resolveResponseModel,
  normalizeWords,
  jaccardOverlap,
  readPairLabelRequests,
  classifyPairLabel,
  buildFixtureBundleSynthesis,
  isBundleSynthesisPrompt,
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
