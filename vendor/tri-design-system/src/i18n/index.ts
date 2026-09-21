/**
 * Tri-Sites Design System · i18n
 * 默认英文（站点面向欧美用户）；en / zh / ja 三语。
 * 用 data-i18n / data-i18n-attr 声明式绑定，切换语言不刷新页面。
 */

export type Lang = 'en' | 'zh' | 'ja';

export const LANGS: { code: Lang; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zh', label: '简体中文', short: '中文' },
  { code: 'ja', label: '日本語', short: '日本語' },
];

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    'nav.home': 'Home',
    'nav.games': 'Games',
    'nav.leaderboard': 'Leaderboard',
    'nav.signin': 'Sign in',
    'nav.menu': 'Menu',
    'lang.switch': 'Language',
    'hero.eyebrow': 'Global multiplayer math',
    'hero.title': 'Race the world to make 24.',
    'hero.lead': 'Four cards. Four operators. One target. Solve faster than up to 99 players worldwide — same cards, same clock.',
    'hero.cta.play': 'Play now',
    'hero.cta.daily': "Today's challenge",
    'hero.stat.games': 'Games',
    'hero.stat.players': 'Players online',
    'hero.stat.room': 'Per room',
    'section.games.title': 'Pick your game',
    'section.games.lead': 'Six brain games — solo practice, daily challenge, or live competition.',
    'daily.badge': 'Daily Challenge',
    'daily.count': 'Puzzles',
    'daily.time': 'Per puzzle',
    'daily.start': 'Start daily',
    'game.play': 'Play',
    'game.practice': 'Practice',
    'game.competition': 'Competition',
    'game.daily': 'Daily',
    'common.loading': 'Loading…',
    'common.retry': 'Retry',
    'common.copy': 'Copy',
    'common.close': 'Close',
    'common.share': 'Share',
    'common.back': 'Back',
    'error.network': 'Connection failed. Check your network and try again.',
  },
  zh: {
    'nav.home': '首页',
    'nav.games': '游戏',
    'nav.leaderboard': '排行榜',
    'nav.signin': '登录',
    'nav.menu': '菜单',
    'lang.switch': '语言',
    'hero.eyebrow': '全球多人数学对战',
    'hero.title': '与全世界竞速，做出 24。',
    'hero.lead': '四张牌、四个运算符、一个目标。与最多 99 名玩家同牌同时竞速，谁先算出 24 谁赢。',
    'hero.cta.play': '开始游戏',
    'hero.cta.daily': '今日挑战',
    'hero.stat.games': '款游戏',
    'hero.stat.players': '在线玩家',
    'hero.stat.room': '每房上限',
    'section.games.title': '选择你的游戏',
    'section.games.lead': '六款思维游戏——单人练习、每日挑战或实时竞赛。',
    'daily.badge': '每日挑战',
    'daily.count': '题目数',
    'daily.time': '每题时间',
    'daily.start': '开始挑战',
    'game.play': '进入',
    'game.practice': '练习',
    'game.competition': '竞赛',
    'game.daily': '每日',
    'common.loading': '加载中…',
    'common.retry': '重试',
    'common.copy': '复制',
    'common.close': '关闭',
    'common.share': '分享',
    'common.back': '返回',
    'error.network': '连接失败，请检查网络后重试。',
  },
  ja: {
    'nav.home': 'ホーム',
    'nav.games': 'ゲーム',
    'nav.leaderboard': 'ランキング',
    'nav.signin': 'ログイン',
    'nav.menu': 'メニュー',
    'lang.switch': '言語',
    'hero.eyebrow': '世界同時対戦の数学ゲーム',
    'hero.title': '世界と競え、24を作れ。',
    'hero.lead': '4枚のカード、4つの演算子、1つのゴール。最大99人と同じカードで同時に競争。',
    'hero.cta.play': '今すぐプレイ',
    'hero.cta.daily': '今日のチャレンジ',
    'hero.stat.games': 'ゲーム',
    'hero.stat.players': 'オンライン',
    'hero.stat.room': '1部屋',
    'section.games.title': 'ゲームを選ぶ',
    'section.games.lead': '6つの脳トレゲーム——練習・デイリー・ライブ対戦。',
    'daily.badge': 'デイリーチャレンジ',
    'daily.count': '問題数',
    'daily.time': '1問の時間',
    'daily.start': 'チャレンジ開始',
    'game.play': 'プレイ',
    'game.practice': '練習',
    'game.competition': '対戦',
    'game.daily': 'デイリー',
    'common.loading': '読み込み中…',
    'common.retry': '再試行',
    'common.copy': 'コピー',
    'common.close': '閉じる',
    'common.share': '共有',
    'common.back': '戻る',
    'error.network': '接続に失敗しました。ネットワークを確認してください。',
  },
};

const STORAGE_KEY = 'tri_lang';
let current: Lang = 'en';

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved && DICT[saved]) return saved;
  } catch {
    /* ignore */
  }
  const nav = (navigator.language || 'en').toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('ja')) return 'ja';
  return 'en';
}

export function getLang(): Lang {
  return current;
}

/** 取词；缺失时回退英文，再回退 key 本身 */
export function t(key: string): string {
  return DICT[current][key] ?? DICT.en[key] ?? key;
}

/** 应用词典到 DOM：data-i18n = 文本，data-i18n-attr = "attr:key[,attr:key]" */
let applying = false;
function apply(root: ParentNode = document): void {
  // 防止 apply() 自身写 DOM 触发 MutationObserver 形成无限递归（曾导致浏览器崩溃）
  if (applying) return;
  applying = true;
  try {
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (key) el.textContent = t(key);
    });
    root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
      const spec = el.dataset.i18nAttr;
      if (!spec) return;
      for (const pair of spec.split(',')) {
        const [attr, key] = pair.split(':').map((s) => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    });
    document.documentElement.lang = current;
  } finally {
    applying = false;
  }
}

export function setLang(lang: Lang): void {
  if (!DICT[lang]) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  apply();
  window.dispatchEvent(new CustomEvent('tri:lang', { detail: { lang } }));
}

/** 挂载语言切换器（原生 <select>，移动端体验最好、天然无障碍） */
export function mountLangSwitcher(host: HTMLElement): void {
  host.innerHTML = '';
  const sel = document.createElement('select');
  sel.className = 'lang-select';
  sel.setAttribute('aria-label', t('lang.switch'));
  for (const l of LANGS) {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = l.short;
    if (l.code === current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => setLang(sel.value as Lang));
  host.appendChild(sel);
}

/**
 * 初始化：探测语言 + 应用词典。
 * 注意：不常驻 MutationObserver —— apply() 会写 DOM，常驻观察会与之形成无限递归
 * （曾导致浏览器崩溃）。动态内容在各自渲染时调用 t()，语言切换由 setLang() 显式重绘。
 */
export function initI18n(): void {
  current = detectLang();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply(), { once: true });
  } else {
    apply();
  }
}
