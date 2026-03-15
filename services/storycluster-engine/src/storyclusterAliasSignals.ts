import { normalizeText } from './textSignals';

interface AliasRule {
  aliases: readonly string[];
  matches(text: string): boolean;
}

function containsAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

const STORYCLUSTER_ALIAS_RULES: readonly AliasRule[] = [
  {
    aliases: ['white_house_flag_burning_case'],
    matches: (text) =>
      /\bwhite house\b/.test(text) &&
      /\bflag\b/.test(text) &&
      /\bburn(?:ed|ing)?\b/.test(text),
  },
  {
    aliases: ['jerome_powell_subpoena_case'],
    matches: (text) =>
      containsAny(text, [/\bjerome powell\b/, /\bfed chair\b/, /\bfederal reserve\b/]) &&
      containsAny(text, [/\bsubpoena(?:s)?\b/, /\bprobe\b/]) &&
      containsAny(text, [/\bjudge\b/, /\bjustice department\b/, /\bdoj\b/]),
  },
  {
    aliases: ['old_dominion_attack_weapon_case'],
    matches: (text) =>
      containsAny(text, [/\bold dominion\b/, /\bvirginia university\b/]) &&
      containsAny(text, [/\bshooter\b/, /\bgunman\b/]) &&
      containsAny(text, [/\bweapon\b/, /\bgun\b/, /\bsold\b/, /\battack\b/]),
  },
  {
    aliases: ['citizenship_renunciation_fee_cut'],
    matches: (text) =>
      /\bstate department\b/.test(text) &&
      /\bcitizenship\b/.test(text) &&
      containsAny(text, [/\brenounce\b/, /\bgive up\b/]) &&
      containsAny(text, [/\bfee\b/, /\bcost\b/, /\bcheaper\b/, /\breduc(?:e|ed|es|ing)\b/, /\bslash(?:ed|es)?\b/]),
  },
  {
    aliases: ['teacher_prank_death_case'],
    matches: (text) =>
      /\bteacher\b/.test(text) &&
      /\bprank\b/.test(text) &&
      (/\bdied\b/.test(text) || /\bdies\b/.test(text) || /\bdeath\b/.test(text)),
  },
  {
    aliases: ['pardon_lobbyist_extortion_case'],
    matches: (text) =>
      /\blobbyist\b/.test(text) &&
      /\bpardon\b/.test(text) &&
      containsAny(text, [/\bextortion\b/, /\benforcer\b/, /\bdemand\b/]),
  },
] as const;

export function inferStoryclusterAliases(title: string, summary?: string): string[] {
  const text = normalizeText(`${title} ${summary ?? ''}`);
  const aliases = new Set<string>();

  for (const rule of STORYCLUSTER_ALIAS_RULES) {
    if (!rule.matches(text)) {
      continue;
    }
    for (const alias of rule.aliases) {
      aliases.add(alias);
    }
  }

  return [...aliases].sort();
}
