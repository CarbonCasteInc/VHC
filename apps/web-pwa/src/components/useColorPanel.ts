import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { COLOR_CONFIGS, STORAGE_KEY, categories } from './colorConfigs';
import { type ColorConfig } from './colorUtils';
import { safeGetItem, safeRemoveItem, safeSetItem } from '../utils/safeStorage';

type ColorValues = { light: string; dark: string };
type GroupedConfigs = Array<{ key: string; title: string; items: ColorConfig[] }>;

export interface UseColorPanelResult {
  isOpen: boolean;
  setIsOpen: Dispatch<SetStateAction<boolean>>;
  isDark: boolean;
  colors: Record<string, ColorValues>;
  activeCategory: string;
  setActiveCategory: Dispatch<SetStateAction<string>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  inspectMode: boolean;
  setInspectMode: Dispatch<SetStateAction<boolean>>;
  inspectedVars: string[];
  panelRef: MutableRefObject<HTMLDivElement | null>;
  controlRefs: MutableRefObject<Record<string, HTMLDivElement | null>>;
  configByVar: Map<string, ColorConfig>;
  categories: string[];
  showSearchResults: boolean;
  groupedConfigs: GroupedConfigs;
  updateColor: (cssVar: string, value: string) => void;
  resetColors: () => void;
  exportCSS: () => void;
  saveAsDefaults: () => void;
  setJumpToVar: Dispatch<SetStateAction<string | null>>;
}
export function useColorPanel(): UseColorPanelResult {
  const [isOpen, setIsOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [colors, setColors] = useState<Record<string, ColorValues>>({});
  const [activeCategory, setActiveCategory] = useState(categories[0] ?? '');
  const [search, setSearch] = useState('');
  const [inspectMode, setInspectMode] = useState(false);
  const [inspectedVars, setInspectedVars] = useState<string[]>([]);
  const [jumpToVar, setJumpToVar] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const controlRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastInspectKeyRef = useRef<string>('');
  const configByVar = useMemo(() => new Map(COLOR_CONFIGS.map((c) => [c.cssVar, c])), []);

  const getDefaults = useCallback(() => {
    const defaults: Record<string, ColorValues> = {};
    COLOR_CONFIGS.forEach((c) => {
      defaults[c.cssVar] = { light: c.defaultLight, dark: c.defaultDark };
    });
    return defaults;
  }, []);

  useEffect(() => {
    const defaults = getDefaults();
    const stored = safeGetItem(STORAGE_KEY);
    if (stored) {
      try {
        // Merge stored values with defaults (so new variables get defaults)
        const parsed = JSON.parse(stored);
        setColors({ ...defaults, ...parsed });
      } catch {
        setColors(defaults);
      }
    } else {
      setColors(defaults);
    }
    setIsDark(document.documentElement.classList.contains('dark'));
  }, [getDefaults]);

  const initDefaults = () => {
    setColors(getDefaults());
  };

  useEffect(() => {
    const root = document.documentElement;
    const mode = isDark ? 'dark' : 'light';
    Object.entries(colors).forEach(([cssVar, values]) => {
      if (values) root.style.setProperty(cssVar, values[mode]);
    });
  }, [colors, isDark]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inspectMode) {
      lastInspectKeyRef.current = '';
      setInspectedVars([]);
      return;
    }

    const extractVarsFromText = (text: string): string[] => {
      const vars: string[] = [];
      const seen = new Set<string>();
      const regex = /var\(\s*(--[a-zA-Z0-9-_]+)\s*(?:,[^)]+)?\)/g;
      let match: RegExpExecArray | null = null;
      while ((match = regex.exec(text))) {
        const found = match[1];
        if (!found || seen.has(found)) continue;
        seen.add(found);
        vars.push(found);
      }
      return vars;
    };

    const parseVarList = (raw: string): string[] =>
      raw
        .split(/[,\s]+/g)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => s.startsWith('--'));

    const extractVarsFromElement = (start: Element): string[] => {
      const collected: string[] = [];
      const seen = new Set<string>();
      let current: Element | null = start;
      let matchesFound = 0;
      for (let depth = 0; current && depth < 8; depth += 1) {
        if (panelRef.current && panelRef.current.contains(current)) return [];

        const before = collected.length;
        const addVar = (v: string) => {
          if (seen.has(v)) return;
          seen.add(v);
          collected.push(v);
        };

        const manual = (current as HTMLElement).dataset?.vhColorVars;
        if (manual) parseVarList(manual).forEach(addVar);

        const styleText = current.getAttribute('style') ?? '';
        extractVarsFromText(styleText).forEach(addVar);

        const classText = current.getAttribute('class') ?? '';
        extractVarsFromText(classText).forEach(addVar);

        if (collected.length > before) matchesFound += 1;
        if (matchesFound >= 3) break;
        current = current.parentElement;
      }
      return collected;
    };

    const onPointerOver = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current && panelRef.current.contains(target)) return;

      const extracted = extractVarsFromElement(target);
      const matched = extracted.filter((v) => configByVar.has(v));

      const key = matched.join('|');
      if (key === lastInspectKeyRef.current) return;
      lastInspectKeyRef.current = key;

      if (matched.length === 0) {
        setInspectedVars([]);
        return;
      }

      setInspectedVars(matched);
      const primary = matched[0];
      if (!primary) return;
      const config = configByVar.get(primary);
      if (config) {
        setActiveCategory(config.category);
        setJumpToVar(primary);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setInspectMode(false);
      }
    };

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [inspectMode, configByVar]);

  useEffect(() => {
    if (!jumpToVar) return;
    const el = controlRefs.current[jumpToVar];
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    setJumpToVar(null);
  }, [jumpToVar, activeCategory, search]);

  const normalizedQuery = search.trim().toLowerCase();
  const showSearchResults = normalizedQuery.length > 0;

  const visibleConfigs = useMemo(() => {
    const matches = (c: ColorConfig) => {
      if (!normalizedQuery) return true;
      const haystack = `${c.category} ${c.group} ${c.label} ${c.cssVar}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    };

    if (showSearchResults) {
      return COLOR_CONFIGS.filter((c) => matches(c) || inspectedVars.includes(c.cssVar));
    }
    return COLOR_CONFIGS.filter((c) => c.category === activeCategory);
  }, [activeCategory, normalizedQuery, showSearchResults, inspectedVars]);

  const groupedConfigs = useMemo(() => {
    const groups: GroupedConfigs = [];
    const index = new Map<string, number>();

    for (const config of visibleConfigs) {
      const key = showSearchResults ? `${config.category}::${config.group}` : config.group;
      const title = showSearchResults ? `${config.category} / ${config.group}` : config.group;
      const existing = index.get(key);
      if (existing === undefined) {
        index.set(key, groups.length);
        groups.push({ key, title, items: [config] });
      } else {
        const targetGroup = groups[existing];
        if (targetGroup) {
          targetGroup.items.push(config);
        }
      }
    }

    return groups;
  }, [visibleConfigs, showSearchResults]);

  const updateColor = (cssVar: string, value: string) => {
    const mode = isDark ? 'dark' : 'light';
    setColors((prev) => {
      const config = configByVar.get(cssVar);
      const current =
        prev[cssVar] ??
        {
          light: config?.defaultLight ?? '',
          dark: config?.defaultDark ?? '',
        };
      const updated = { ...prev, [cssVar]: { ...current, [mode]: value } };
      safeSetItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const resetColors = () => {
    initDefaults();
    safeRemoveItem(STORAGE_KEY);
  };

  const exportCSS = () => {
    const lightVars = COLOR_CONFIGS.map(
      (c) => `  ${c.cssVar}: ${colors[c.cssVar]?.light || c.defaultLight};`
    ).join('\n');
    const darkVars = COLOR_CONFIGS.map(
      (c) => `  ${c.cssVar}: ${colors[c.cssVar]?.dark || c.defaultDark};`
    ).join('\n');
    const css = `:root {\n${lightVars}\n}\n\n.dark {\n${darkVars}\n}`;
    navigator.clipboard.writeText(css);
    alert('CSS copied to clipboard!');
  };

  const saveAsDefaults = () => {
    const formatValue = (val: string) => `'${val}'`;

    let lightSection = '';
    let darkSection = '';

    categories.forEach((category) => {
      lightSection += `          // ${category}\n`;
      darkSection += `          // ${category}\n`;

      const groupMap = new Map<string, ColorConfig[]>();
      COLOR_CONFIGS.filter((c) => c.category === category).forEach((c) => {
        const list = groupMap.get(c.group) ?? [];
        list.push(c);
        groupMap.set(c.group, list);
      });

      for (const [group, configs] of groupMap) {
        lightSection += `          // - ${group}\n`;
        darkSection += `          // - ${group}\n`;
        configs.forEach((c) => {
          const lightVal = colors[c.cssVar]?.light || c.defaultLight;
          const darkVal = colors[c.cssVar]?.dark || c.defaultDark;
          lightSection += `          '${c.cssVar}': ${formatValue(lightVal)},\n`;
          darkSection += `          '${c.cssVar}': ${formatValue(darkVal)},\n`;
        });
      }
    });

    const tailwindConfig = `// 📋 PASTE THIS INTO tailwind.config.cjs (replace the addBase section)
// Generated: ${new Date().toLocaleString()}

plugins: [
  require('tailwindcss/plugin')(function ({ addBase }) {
    addBase({
      ':root': {
${lightSection}      },
      '.dark': {
${darkSection}      }
    });
  })
]`;

    navigator.clipboard.writeText(tailwindConfig);
    alert(
      '✅ Tailwind config copied to clipboard!\n\nPaste into tailwind.config.cjs to make these your new defaults.'
    );
  };

  return {
    isOpen,
    setIsOpen,
    isDark,
    colors,
    activeCategory,
    setActiveCategory,
    search,
    setSearch,
    inspectMode,
    setInspectMode,
    inspectedVars,
    panelRef,
    controlRefs,
    configByVar,
    categories,
    showSearchResults,
    groupedConfigs,
    updateColor,
    resetColors,
    exportCSS,
    saveAsDefaults,
    setJumpToVar,
  };
}
