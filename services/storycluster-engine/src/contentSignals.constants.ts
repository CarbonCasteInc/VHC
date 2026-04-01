export const LANGUAGE_MAP: Record<string, string> = {
  eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt', nld: 'nl', rus: 'ru',
  ukr: 'uk', arb: 'ar', cmn: 'zh', jpn: 'ja', kor: 'ko', hin: 'hi', tur: 'tr',
};

export const ACTION_CATEGORIES = new Map<string, string>([
  ['attack', 'conflict'], ['attacks', 'conflict'], ['strike', 'conflict'], ['strikes', 'conflict'],
  ['bombing', 'conflict'], ['raid', 'conflict'], ['clash', 'conflict'], ['invasion', 'conflict'],
  ['cyberattack', 'infrastructure_disruption'], ['ransomware', 'infrastructure_disruption'],
  ['blackout', 'infrastructure_disruption'], ['outage', 'infrastructure_disruption'],
  ['failure', 'infrastructure_disruption'], ['fails', 'infrastructure_disruption'], ['failed', 'infrastructure_disruption'],
  ['forced', 'infrastructure_disruption'], ['rerouted', 'infrastructure_disruption'], ['reroute', 'infrastructure_disruption'],
  ['left', 'infrastructure_disruption'], ['continued', 'infrastructure_disruption'], ['continues', 'infrastructure_disruption'],
  ['troop', 'military_posture'], ['troops', 'military_posture'], ['deploy', 'military_posture'],
  ['deploys', 'military_posture'], ['deployment', 'military_posture'], ['base', 'military_posture'],
  ['bases', 'military_posture'], ['carrier', 'military_posture'], ['missile', 'military_posture'],
  ['missiles', 'military_posture'],
  ['drill', 'preparedness'], ['drills', 'preparedness'], ['exercise', 'preparedness'], ['exercises', 'preparedness'],
  ['election', 'politics'], ['elections', 'politics'], ['vote', 'politics'], ['votes', 'politics'],
  ['schedule', 'politics'], ['schedules', 'politics'], ['scheduled', 'politics'], ['resigns', 'politics'],
  ['tell', 'diplomacy'], ['tells', 'diplomacy'], ['told', 'diplomacy'], ['urge', 'diplomacy'], ['urges', 'diplomacy'],
  ['warn', 'diplomacy'], ['warns', 'diplomacy'], ['meet', 'diplomacy'], ['meets', 'diplomacy'],
  ['refuse', 'diplomacy'], ['refuses', 'diplomacy'], ['refused', 'diplomacy'],
  ['arrest', 'legal'], ['arrests', 'legal'], ['arrested', 'legal'], ['charged', 'legal'],
  ['charges', 'legal'], ['detain', 'legal'], ['detains', 'legal'], ['detained', 'legal'],
  ['detention', 'legal'], ['review', 'legal'], ['reviews', 'legal'], ['trial', 'legal'], ['lawsuit', 'legal'],
  ['shoot', 'conflict'], ['shoots', 'conflict'], ['shot', 'conflict'],
  ['earthquake', 'disaster'], ['flood', 'disaster'], ['wildfire', 'disaster'], ['storm', 'disaster'],
  ['market', 'economic'], ['stocks', 'economic'], ['slide', 'economic'], ['slides', 'economic'],
  ['cut', 'economic'], ['cuts', 'economic'], ['tariff', 'economic'], ['inflation', 'economic'],
  ['bring', 'economic'], ['brings', 'economic'], ['bringing', 'economic'],
  ['seize', 'military_posture'], ['seizes', 'military_posture'], ['seizing', 'military_posture'],
  ['talks', 'diplomacy'], ['summit', 'diplomacy'], ['sanctions', 'diplomacy'], ['ceasefire', 'diplomacy'],
  ['convicted', 'legal_verdict'], ['guilty', 'legal_verdict'], ['verdict', 'legal_verdict'], ['found', 'legal_verdict'],
]);

export const TRIGGER_PRIORITY = new Map<string, number>([
  ['conflict', 6],
  ['military_posture', 5],
  ['disaster', 5],
  ['preparedness', 5],
  ['legal', 4],
  ['legal_verdict', 4],
  ['infrastructure_disruption', 4],
  ['economic', 3],
  ['politics', 2],
  ['diplomacy', 1],
]);

export const LOCATION_LEXICON = new Set([
  'iran', 'israel', 'gaza', 'ukraine', 'russia', 'china', 'taiwan', 'tehran', 'jerusalem', 'kyiv',
  'washington', 'london', 'paris', 'berlin', 'tokyo', 'beijing', 'moscow', 'brussels', 'cairo',
  'mexico', 'canada', 'california', 'texas', 'new york', 'los angeles', 'europe', 'asia', 'africa',
]);

export const TITLE_TRANSLATION_LEXICON: Record<string, Record<string, string>> = {
  es: {
    ataque: 'attack', ataques: 'attacks', puerto: 'port', mercado: 'market', guerra: 'war',
    elecciones: 'elections', incendio: 'fire', terremoto: 'earthquake', huelga: 'strike',
    rescate: 'rescue', gobierno: 'government', explosión: 'explosion', crisis: 'crisis',
  },
  fr: {
    attaque: 'attack', attaques: 'attacks', port: 'port', marche: 'market', guerre: 'war',
    elections: 'elections', incendie: 'fire', seisme: 'earthquake', greve: 'strike',
    secours: 'rescue', gouvernement: 'government', explosion: 'explosion', crise: 'crisis',
  },
};

export const LIVEBLOG_PATTERN = /\blive\b|live updates|liveblog|minute by minute/;
export const VIDEO_PATTERN = /\bvideo\b|\bwatch\b|\bclip\b|\/video(s)?\//;
export const OPINION_PATTERN = /\bopinion\b|editorial|column|guest essay|analysis opinion/;
export const ANALYSIS_PATTERN = /\banalysis\b|\bcommentary\b|what it means|why it matters|why the .*?\b(?:becoming|means|matters|tests?)\b|takeaways|inside the/;
export const EXPLAINER_PATTERN = /\bexplainer\b|what we know|timeline|recap|key moments|at a glance|roundup|what to know/;
export const BREAKING_PATTERN = /\bbreaking\b|developing|alert|just in/;
export const WIRE_PATTERN = /reuters|associated press|ap\b|afp|upi|wire/;

export const CONTRAST_CLAUSES = [
  ' even as ',
  ' as ',
  ' while ',
  ' amid ',
  ' despite ',
] as const;

export const WEEKDAY_TEMPORAL_TOKENS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);
