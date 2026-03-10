import { createServer } from 'node:http';

const port = Number.parseInt(process.env.VH_DAEMON_FEED_FIXTURE_PORT ?? '8788', 10);
const baseUrl = `http://127.0.0.1:${port}`;

function rssDate(iso) {
  return new Date(iso).toUTCString();
}

function articleHtml(title, paragraphs) {
  const body = paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <main>
      <article>
        <h1>${title}</h1>
        ${body}
      </article>
    </main>
  </body>
</html>`;
}

const articles = {
  'geneva-guardian': {
    title: 'Geneva ceasefire talks open after overnight missile strike',
    description: 'Mediators convened in Geneva after an overnight missile strike prompted emergency diplomacy.',
    publishedAt: '2026-03-09T15:00:00Z',
    html: articleHtml('Geneva ceasefire talks open after overnight missile strike', [
      'Mediators from three countries opened emergency ceasefire talks in Geneva on Monday morning after an overnight missile strike damaged fuel depots near the capital.',
      'Diplomats said the same negotiating table will address the overnight strike, the release of detainees and guarantees for shipping lanes during the truce window.',
      'Officials described the Geneva meeting as the first direct ceasefire session since the overnight strike escalated the conflict.',
    ]),
  },
  'geneva-cbs': {
    title: 'Emergency Geneva talks begin after overnight missile strike hits fuel depots',
    description: 'Delegations opened emergency Geneva talks after the overnight strike hit fuel depots and forced a diplomatic response.',
    publishedAt: '2026-03-09T15:06:00Z',
    html: articleHtml('Emergency Geneva talks begin after overnight missile strike hits fuel depots', [
      'Emergency ceasefire talks began in Geneva after an overnight missile strike hit fuel depots and forced negotiators back to the table.',
      'Officials said the Geneva session is focused on the overnight strike, protection for shipping routes and a staged ceasefire backed by mediators.',
      'Diplomats described the meeting as the first direct response to the missile strike and said additional talks are planned for Tuesday.',
    ]),
  },
  'tsa-bbc': {
    title: 'Staffing shortage leads to two-hour TSA lines at major US airports',
    description: 'Travelers faced long lines after a staffing shortage slowed security checkpoints at major airports.',
    publishedAt: '2026-03-09T15:10:00Z',
    html: articleHtml('Staffing shortage leads to two-hour TSA lines at major US airports', [
      'Travelers at major U.S. airports faced security lines of up to two hours after a staffing shortage reduced the number of open TSA checkpoints.',
      'Airport managers in Atlanta, Chicago and Dallas said the delays began before sunrise and persisted through the morning departure bank.',
      'Federal officials said they were reassigning staff and extending shifts to reduce the security backlog created by the shortage.',
    ]),
  },
  'tsa-fox': {
    title: 'Travelers face long TSA waits as staffing shortfall hits major airports',
    description: 'Long TSA waits spread across major airports after a staffing shortfall disrupted checkpoint operations.',
    publishedAt: '2026-03-09T15:14:00Z',
    html: articleHtml('Travelers face long TSA waits as staffing shortfall hits major airports', [
      'Long TSA waits spread across major airports after a staffing shortfall disrupted checkpoint operations during the morning travel rush.',
      'Passengers in Atlanta, Chicago and Dallas reported lines nearing two hours as officials consolidated lanes and reassigned officers.',
      'Transportation officials said they were deploying backup teams to relieve the backlog caused by the staffing problem.',
    ]),
  },
  'iran-roundup-nypost': {
    title: 'Trump says conflict could end soon while oil routes stay under pressure',
    description: 'A roundup of statements on the conflict, shipping lanes and diplomatic pressure.',
    publishedAt: '2026-03-09T15:18:00Z',
    html: articleHtml('Trump says conflict could end soon while oil routes stay under pressure', [
      'President Trump said the conflict could end soon as officials weighed diplomatic proposals and military options across the region.',
      'The roundup also covered pressure on oil routes, public statements from allied governments and broader debate about the next phase of the conflict.',
      'Officials did not tie the statements to a single incident, describing the situation instead as a fast-moving regional crisis.',
    ]),
  },
  'school-noise-guardian': {
    title: 'California teachers weigh whether to leave profession, survey finds',
    description: 'A state survey found many teachers are considering leaving the profession within the decade.',
    publishedAt: '2026-03-09T15:22:00Z',
    html: articleHtml('California teachers weigh whether to leave profession, survey finds', [
      'A new California survey found that many teachers are considering leaving the profession within the next decade because of workload and pay pressures.',
      'Education officials said the survey was conducted statewide and was not tied to a single district or incident.',
      'Teacher groups said the results should inform staffing and retention plans before the next school year.',
    ]),
  },
  'mayor-guardian': {
    title: 'City hall attack injures mayor and top aide before budget vote',
    description: 'Investigators said the mayor and a senior aide were injured in a blast outside city hall before a budget vote.',
    publishedAt: '2026-03-09T15:26:00Z',
    html: articleHtml('City hall attack injures mayor and top aide before budget vote', [
      'The mayor and a senior aide were injured in a blast outside city hall hours before a scheduled budget vote, according to investigators.',
      'Police said the attack damaged official vehicles and forced lawmakers to evacuate the surrounding block while bomb technicians secured the area.',
      'Officials described the explosion as a targeted attack tied to the city hall complex and said the mayor was taken to hospital in stable condition.',
    ]),
  },
  'mayor-bbc': {
    title: 'Mayor hospitalised after blast outside city hall ahead of budget session',
    description: 'A blast outside city hall injured the mayor before a budget session and triggered an emergency security response.',
    publishedAt: '2026-03-09T15:31:00Z',
    html: articleHtml('Mayor hospitalised after blast outside city hall ahead of budget session', [
      'The mayor was hospitalised after a blast outside city hall ahead of a budget session, with officials saying a senior aide was also hurt.',
      'Security forces cleared the area around city hall and suspended the scheduled vote while investigators examined damaged vehicles and debris.',
      'Authorities said the explosion targeted the city hall entrance and launched a major emergency response across the district.',
    ]),
  },
  'fraud-cbs': {
    title: 'Brothers convicted in luxury condo fraud trial after six-week case',
    description: 'A jury convicted two brothers in a luxury condo fraud trial tied to investor losses and forged records.',
    publishedAt: '2026-03-09T15:36:00Z',
    html: articleHtml('Brothers convicted in luxury condo fraud trial after six-week case', [
      'A jury convicted two brothers in a luxury condo fraud trial after prosecutors said they forged records and diverted investor money.',
      'Jurors returned guilty verdicts on fraud and conspiracy counts after a six-week case focused on losses tied to a downtown tower project.',
      'Prosecutors said sentencing will address the multimillion-dollar investor losses and restitution claims raised during the trial.',
    ]),
  },
  'fraud-nypost': {
    title: 'Luxury tower brothers found guilty in multimillion-dollar fraud case',
    description: 'Two brothers were found guilty in a multimillion-dollar fraud case involving a luxury tower project and investor money.',
    publishedAt: '2026-03-09T15:40:00Z',
    html: articleHtml('Luxury tower brothers found guilty in multimillion-dollar fraud case', [
      'Two brothers were found guilty in a multimillion-dollar fraud case tied to a luxury tower project after prosecutors detailed forged records and missing investor funds.',
      'The jury convicted the pair on fraud and conspiracy counts at the end of a six-week trial centered on the downtown condominium development.',
      'Sentencing is expected later this spring as prosecutors seek restitution for investors caught up in the tower scheme.',
    ]),
  },
};

const feeds = {
  'guardian-us': [
    { articleId: 'geneva-guardian' },
    { articleId: 'school-noise-guardian' },
    { articleId: 'mayor-guardian' },
  ],
  'cbs-politics': [
    { articleId: 'geneva-cbs' },
    { articleId: 'fraud-cbs' },
  ],
  'bbc-us-canada': [
    { articleId: 'tsa-bbc' },
    { articleId: 'mayor-bbc' },
  ],
  'fox-latest': [
    { articleId: 'tsa-fox' },
  ],
  'nypost-politics': [
    { articleId: 'iran-roundup-nypost' },
    { articleId: 'fraud-nypost' },
  ],
};

function feedXml(sourceId) {
  const items = (feeds[sourceId] ?? []).map(({ articleId }) => {
    const article = articles[articleId];
    return `      <item>
        <title>${article.title}</title>
        <link>${baseUrl}/article/${articleId}</link>
        <description>${article.description}</description>
        <pubDate>${rssDate(article.publishedAt)}</pubDate>
      </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${sourceId}</title>
${items}
  </channel>
</rss>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', baseUrl);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname.startsWith('/rss/')) {
    const sourceId = url.pathname.slice('/rss/'.length);
    if (!(sourceId in feeds)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' });
    res.end(feedXml(sourceId));
    return;
  }

  if (url.pathname.startsWith('/article/')) {
    const articleId = url.pathname.slice('/article/'.length);
    const article = articles[articleId];
    if (!article) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(article.html);
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[vh:e2e-fixture-feed] listening on ${baseUrl}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
