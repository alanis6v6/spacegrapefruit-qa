// 知識+ 名牌機器人的核心：全部是純函式／可注入資料的函式，測試時餵假的 GraphQL 回應就能跑。
// 規則（等級、顏色、暱稱）改這裡；README 有白話說明。

export const REGISTRY_TITLE = '名牌登記處';
export const HOST_LOGIN = 'alanis6v6';
export const HOST = { nickname: '太空葡萄柚', color: 'rainbow', level: 3 };
export const NICK_MAX = 12;

// ---------- 顏色 ----------
// tier：0＝單色（1–2 級）、1＝兩色漸層（3–5 級）、2＝流動彩條（6 級以上）、-1＝保留（別人選不到）
// butter（鵝黃）網站色值：日間 oklch(52% .11 85)（對 #f5eefe）、夜間 oklch(88% .12 95)（對 #1b1426），見 docs/nameplate-bot.md
// id 對應網站 qa/qa.css 的 .tag-<id>；改色票時兩邊一起改。
export const COLORS = [
  { id: 'pink',    name: '葡萄柚粉', tier: 0 },
  { id: 'fruit',   name: '果肉橘',   tier: 0 },
  { id: 'gold',    name: '蜜金',     tier: 0 },
  { id: 'butter',  name: '鵝黃',     tier: 0 },
  { id: 'mint',    name: '薄荷綠',   tier: 0 },
  { id: 'sky',     name: '天空藍',   tier: 0 },
  { id: 'sunset',  name: '日落',     tier: 1 },
  { id: 'meadow',  name: '草地',     tier: 1 },
  { id: 'sea',     name: '海汐',     tier: 1 },
  { id: 'lilac',   name: '丁香',     tier: 1 },
  { id: 'candy',   name: '糖漿',     tier: 2 },
  { id: 'aurora',  name: '極光',     tier: 2 },
  { id: 'soda',    name: '汽水',     tier: 2 },
  { id: 'rainbow', name: '彩虹',     tier: -1, reservedFor: '太空葡萄柚' },
  { id: 'moon',    name: '月光',     tier: -1, reservedFor: '知識長' },
];
export const TIER_DEFAULT = ['pink', 'sunset', 'candy'];

export function levelTier(level) { return level >= 6 ? 2 : level >= 3 ? 1 : 0; }

export function findColor(raw) {
  const k = String(raw || '').replace(/[`'"「」『』\s]/g, '').toLowerCase();
  if (!k) return null;
  return COLORS.find((c) => c.id === k || c.name === k) || null;
}

// 選的顏色超過等級、保留色、或根本不存在 → 給這個等級能用的預設
export function resolveColor(requested, level) {
  const tier = levelTier(level);
  const c = findColor(requested);
  if (c && c.tier >= 0 && c.tier <= tier) return c.id;
  return TIER_DEFAULT[tier];
}

// ---------- 暱稱 ----------
export function parseBlocklist(text) {
  return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')).map((s) => s.toLowerCase()).filter((s) => s.replace(/\s+/g, ''));
}
export function sanitizeNickname(raw, login, blocklist = []) {
  // 去控制字元、前後空白（含全形空白）；最多 12 字（以字為單位，不會把表情符號切半）
  let n = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  n = [...n].slice(0, NICK_MAX).join('').trim();
  if (!n) return login;
  const flat = n.toLowerCase().replace(/\s+/g, '');
  if (blocklist.some((w) => flat.includes(w.replace(/\s+/g, '')))) return login;
  return n;
}

// ---------- 登記格式 ----------
// 接受：「暱稱：XXX 顏色：YYY」，冒號全形半形都行、空白（含全形）多寡不拘、兩個欄位換行或同一行都行、順序反過來也行。
// 只寫其中一個也算有效（沒寫的那個用預設）。
// 登記處必須在 Announcements（只有站長能開），別人在 Q&A 開同名討論串不算
export const isRegistry = (d) => d.title.trim() === REGISTRY_TITLE && !!d.category && d.category.slug === 'announcements';

export function parseRegistration(body) {
  const t = String(body || '').replace(/[：﹕꞉]/g, ':');
  const nickM = t.match(/暱稱\s*:\s*([\s\S]*?)(?=\s*(?:顏色|色票|名條)\s*:|\n|$)/);
  const colM = t.match(/(?:顏色|色票|名條)\s*:\s*([^\s\n]+)/);
  const nickname = nickM ? nickM[1].replace(/^[\s`'"「『]+|[\s`'"」』]+$/g, '') : null;
  const color = colM ? colM[1].replace(/[，,。、；;！!（(].*$/, '').replace(/^[`'"「『]+|[`'"」』]+$/g, '') : null;
  if (!nickname && !color) return null;
  return { nickname: nickname || null, color: color || null };
}

// ---------- GraphQL 讀取（含分頁）----------
const COMMENT_FIELDS = 'nodes { body bodyHTML isAnswer createdAt author { login } } pageInfo { hasNextPage endCursor }';
export const Q_DISCUSSIONS = `query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    id
    discussionCategories(first:50){ nodes { id name slug } }
    discussions(first:30, after:$after, orderBy:{field:CREATED_AT, direction:ASC}){
      pageInfo { hasNextPage endCursor }
      nodes { id number title url createdAt body bodyHTML isAnswered answer { author { login } } category { name slug } author { login }
        comments(first:100){ ${COMMENT_FIELDS} } }
    }
  }
}`;
export const Q_MORE_COMMENTS = `query($id:ID!,$after:String){
  node(id:$id){ ... on Discussion { comments(first:100, after:$after){ ${COMMENT_FIELDS} } } }
}`;

// gql(query, variables) → data；測試時換成假的
export async function fetchAll(gql, owner, name) {
  const discussions = []; let after = null, repoId = null, categories = [];
  for (let guard = 0; guard < 1000; guard++) {
    const d = await gql(Q_DISCUSSIONS, { owner, name, after });
    const r = d.repository;
    repoId = r.id; categories = r.discussionCategories.nodes;
    for (const disc of r.discussions.nodes) {
      const all = [...disc.comments.nodes];
      let pi = disc.comments.pageInfo;
      while (pi && pi.hasNextPage) {
        const m = await gql(Q_MORE_COMMENTS, { id: disc.id, after: pi.endCursor });
        const c = m.node.comments; all.push(...c.nodes); pi = c.pageInfo;
      }
      discussions.push({ ...disc, comments: all });
    }
    if (!r.discussions.pageInfo.hasNextPage) break;
    after = r.discussions.pageInfo.endCursor;
  }
  return { repoId, categories, discussions };
}

// ---------- 計算 ----------
export function normPath(p) {
  return String(p || '').trim().replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/\/index\.html$/i, '').replace(/^\/+|\/+$/g, '');
}
const isBot = (l) => !l || /\[bot\]$/i.test(l) || l.toLowerCase() === 'github-actions';
const avatarOf = (login) => `https://github.com/${login}.png?size=64`;

export function compute({ discussions, blocklist = [], now = new Date(), registry: pinned = null }) {
  const registry = pinned || discussions.find(isRegistry) || null;
  const stats = new Map();   // login(小寫) → { login, answers, accepted }
  const pages = new Map();   // pathname → Map(login小寫 → count)
  const get = (login) => {
    const k = login.toLowerCase();
    if (!stats.has(k)) stats.set(k, { login, answers: 0, accepted: 0 });
    return stats.get(k);
  };
  for (const d of discussions) {
    if (d === registry) continue;
    const cat = (d.category && d.category.slug) || '';
    const isPage = cat === 'announcements', isQA = cat === 'q-a';
    if (!isPage && !isQA) continue;
    const asker = d.author && d.author.login ? d.author.login.toLowerCase() : '';
    for (const c of d.comments) {
      const who = c.author && c.author.login;
      if (isBot(who)) continue;
      if (isQA && who.toLowerCase() === asker) continue;   // Q&A 只算「別人的」問題
      const s = get(who); s.answers++;
      if (isQA && c.isAnswer) s.accepted++;
      if (isPage) {
        const p = normPath(d.title);
        if (!pages.has(p)) pages.set(p, new Map());
        const m = pages.get(p), k = who.toLowerCase();
        m.set(k, (m.get(k) || 0) + 1);
      }
    }
  }
  // 登記：每人最新一則有效的
  const reg = new Map();
  if (registry) {
    const sorted = [...registry.comments].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const c of sorted) {
      const who = c.author && c.author.login;
      if (isBot(who)) continue;
      const p = parseRegistration(c.body);
      if (p) reg.set(who.toLowerCase(), p);
    }
  }
  // 太空葡萄柚就算沒留過言也要在名單裡（固定顯示）
  get(HOST_LOGIN);
  const people = [...stats.values()].map((s) => {
    const level = 1 + s.answers + s.accepted * 3;
    const r = reg.get(s.login.toLowerCase());
    if (s.login.toLowerCase() === HOST_LOGIN) {
      return { login: s.login, nickname: HOST.nickname, color: HOST.color, level: HOST.level, answers: s.answers, accepted: s.accepted, avatar: avatarOf(s.login), host: true };
    }
    return {
      login: s.login,
      nickname: sanitizeNickname(r && r.nickname, s.login, blocklist),
      color: resolveColor(r && r.color, level),
      level, answers: s.answers, accepted: s.accepted, avatar: avatarOf(s.login),
    };
  });
  // 排名：等級 > 被選為解答 > 回答數 > 帳號；站長固定放最後（不參與排名，網站也不顯示在榜上）
  people.sort((a, b) => (a.host ? 1 : 0) - (b.host ? 1 : 0) || b.level - a.level || b.accepted - a.accepted || b.answers - a.answers || a.login.localeCompare(b.login));
  const byLogin = new Map(people.map((p) => [p.login.toLowerCase(), p]));
  const pageOut = {};
  for (const [p, m] of [...pages.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    pageOut[p] = [...m.entries()].filter(([k]) => byLogin.has(k) && !byLogin.get(k).host)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => byLogin.get(k).login);
  }
  return {
    updatedAt: now.toISOString(),
    registryUrl: registry ? registry.url : null,
    people, pages: pageOut,
  };
}

// ---------- 題目清單（data/questions.json）----------
// giscus 自動開的討論：作者是 giscus 開頭或 [bot] 結尾的帳號，且內文含 giscus 的標記（<!-- sha1: ... -->）
export function isGiscusDiscussion(d) {
  const login = (d.author && d.author.login) || '';
  const botLike = /^giscus/i.test(login) || /\[bot\]$/i.test(login);
  return botLike && /<!--\s*sha1:\s*[0-9a-f]+\s*-->/i.test(String(d.body || ''));
}
// 標題是網站頁面路徑（例如 qa/sillytavern-railway-to-docker/）：沒有空白、至少一個斜線、只含網址字元
export function isPagePathTitle(title) {
  const t = String(title || '').trim();
  return /^\/?[A-Za-z0-9_.~%-]+(\/[A-Za-z0-9_.~%-]*)+$/.test(t);
}
export function extractTags(title) {
  const m = String(title || '').match(/^(?:\s*\[[^\]]+\])+/);
  return m ? [...m[0].matchAll(/\[([^\]]+)\]/g)].map((x) => x[1].trim()).filter(Boolean) : [];
}
const authorOf = (a) => { const login = (a && a.login) || 'ghost'; return { login, avatar: avatarOf(login) }; };

export function buildQuestions({ discussions, now = new Date(), registry: pinned = null }) {
  const registry = pinned || discussions.find(isRegistry) || null;
  const out = [];
  for (const d of discussions) {
    if (d === registry || isRegistry(d)) continue;
    const slug = (d.category && d.category.slug) || '';
    const isQA = slug === 'q-a';
    const isPage = slug === 'announcements' && isPagePathTitle(d.title);
    if (!isQA && !isPage) continue;
    let author = d.author, bodyHTML = d.bodyHTML == null ? '' : d.bodyHTML, comments = d.comments || [];
    // 站內發問（giscus 開的串）：第一則頂層留言才是題目與發問人；只用在 Q&A，頁面串（Announcements）的內文是頁面介紹，不換
    const viaGiscus = isQA && isGiscusDiscussion(d);
    if (viaGiscus && comments.length) {
      const first = comments[0];
      author = first.author; bodyHTML = first.bodyHTML == null ? '' : first.bodyHTML; comments = comments.slice(1);
    }
    const asker = author && author.login ? author.login.toLowerCase() : '';
    const answers = comments.filter((c) => !(asker && c.author && c.author.login && c.author.login.toLowerCase() === asker)).length;
    const q = {
      number: d.number, title: d.title, url: d.url,
      category: (d.category && d.category.name) || '', categorySlug: slug,
      author: authorOf(author), createdAt: d.createdAt || null, bodyHTML,
      answers,
      answered: isQA && d.isAnswered === true,
      answerAuthor: isQA && d.answer && d.answer.author ? d.answer.author.login : null,
      tags: extractTags(d.title),
      viaGiscus,
    };
    if (isPage) q.pagePath = d.title.trim();
    out.push(q);
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.number - a.number);
  return { updatedAt: now.toISOString(), questions: out };
}
export const summarizeQuestions = (qs) => `questions.json：${qs.questions.length} 題\n` +
  qs.questions.map((q) => `  #${q.number} ${q.title}（answers=${q.answers}${q.pagePath ? ', pagePath=' + q.pagePath : ''}${q.viaGiscus ? ', viaGiscus' : ''}）`).join('\n');

// 內容沒變（不看 updatedAt）就不用寫檔、不用 commit
export function sameContent(oldJson, newObj) {
  if (!oldJson) return false;
  let o; try { o = typeof oldJson === 'string' ? JSON.parse(oldJson) : oldJson; } catch { return false; }
  const strip = (x) => JSON.stringify({ ...x, updatedAt: null });
  return strip(o) === strip(newObj);
}
export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';

// 整套流程（注入 gql、讀檔、寫檔）：回傳 { wrote, registryFound }。完全唯讀，不會在討論區建任何東西。
// 找不到登記處＝沒有登記資料，照常算完（不 throw）。
// registryNumber（可選）：直接指定登記處的討論編號；沒給就用 isRegistry（Announcements 分類＋標題「名牌登記處」）找。
export async function runBot({ gql, owner, name, blocklistText, readOld, write, now, registryNumber, readOldQuestions, writeQuestions }) {
  const data = await fetchAll(gql, owner, name);
  const n = Number(registryNumber);
  const pinned = Number.isInteger(n) && n > 0 ? data.discussions.find((d) => d.number === n) : null;
  const out = compute({ discussions: data.discussions, blocklist: parseBlocklist(blocklistText), now, registry: pinned });
  const registryFound = !!out.registryUrl;
  const questions = buildQuestions({ discussions: data.discussions, now, registry: pinned });
  let questionsWrote = false;
  if (writeQuestions && !sameContent(readOldQuestions ? await readOldQuestions() : null, questions)) {
    await writeQuestions(serialize(questions)); questionsWrote = true;
  }
  if (sameContent(await readOld(), out)) return { wrote: false, registryFound, questions, questionsWrote };
  await write(serialize(out));
  return { wrote: true, registryFound, questions, questionsWrote };
}
