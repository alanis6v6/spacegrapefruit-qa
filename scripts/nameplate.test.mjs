import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegistration, resolveColor, sanitizeNickname, parseBlocklist, fetchAll, compute, sameContent, runBot, findColor, COLORS, Q_DISCUSSIONS, Q_MORE_COMMENTS } from './lib.mjs';

const cm = (login, body = 'x', extra = {}) => ({ body, isAnswer: false, createdAt: '2026-11-01T00:00:00Z', author: { login }, ...extra });
const disc = (o) => ({ id: 'D' + o.number, url: 'https://github.com/o/r/discussions/' + o.number, author: { login: 'giscus' }, comments: [], ...o });
const ann = (n, title, comments) => disc({ number: n, title, category: { slug: 'announcements', name: 'Announcements' }, comments });
const qa = (n, asker, comments) => disc({ number: n, title: 'Q' + n, author: { login: asker }, category: { slug: 'q-a', name: 'Q&A' }, comments });
const registry = (comments) => ann(99, '名牌登記處', comments);

test('登記格式容錯：全形半形冒號、空白、換行、順序、反引號', () => {
  assert.deepEqual(parseRegistration('暱稱：小明 顏色：薄荷綠'), { nickname: '小明', color: '薄荷綠' });
  assert.deepEqual(parseRegistration('暱稱:小明  顏色:mint'), { nickname: '小明', color: 'mint' });
  assert.deepEqual(parseRegistration('暱稱 ： 小 明　顏色　：　日落'), { nickname: '小 明', color: '日落' });
  assert.deepEqual(parseRegistration('暱稱：小明\n顏色：天空藍\n謝謝'), { nickname: '小明', color: '天空藍' });
  assert.deepEqual(parseRegistration('顏色：pink 暱稱：反過來'), { nickname: '反過來', color: 'pink' });
  assert.deepEqual(parseRegistration('`暱稱：小明 顏色：薄荷綠`'), { nickname: '小明', color: '薄荷綠' });
  assert.deepEqual(parseRegistration('暱稱：只有名字'), { nickname: '只有名字', color: null });
  assert.equal(parseRegistration('大家好'), null);
  assert.equal(parseRegistration('暱稱：小明 顏色：薄荷綠（謝謝）').color, '薄荷綠');
  assert.equal(parseRegistration('暱稱：小明，顏色：mint，謝謝').color, 'mint');
});

test('超級距顏色降級、保留色拿不到、未知色給預設', () => {
  assert.equal(resolveColor('薄荷綠', 1), 'mint');
  assert.equal(resolveColor('日落', 2), 'pink');       // 漸層要 3 級
  assert.equal(resolveColor('日落', 3), 'sunset');
  assert.equal(resolveColor('candy', 5), 'sunset');    // 流動要 6 級，降到 3–5 級預設
  assert.equal(resolveColor('糖漿', 6), 'candy');
  assert.equal(resolveColor('pink', 9), 'pink');       // 高等級也可以選低級距的
  assert.equal(resolveColor('彩虹', 99), 'candy');     // 保留色
  assert.equal(resolveColor('月光', 99), 'candy');
  assert.equal(resolveColor('不存在', 1), 'pink');
  assert.equal(resolveColor(null, 4), 'sunset');
});

test('暱稱：去前後空白、最多 12 字、空的用帳號', () => {
  assert.equal(sanitizeNickname('  小明  ', 'abc'), '小明');
  assert.equal(sanitizeNickname('　小明　', 'abc'), '小明');
  assert.equal(sanitizeNickname('一二三四五六七八九十一二三四', 'abc'), '一二三四五六七八九十一二');
  assert.equal(sanitizeNickname('😀😀😀😀😀😀😀😀😀😀😀😀😀😀', 'abc').length, 24);   // 12 個表情符號沒被切半
  assert.equal(sanitizeNickname('   ', 'abc'), 'abc');
  assert.equal(sanitizeNickname('<b>x</b>', 'abc'), 'bx/b');                       // < > 直接拿掉
});

test('blocklist：含黑名單字改顯示帳號；註解與空行忽略；不分大小寫、忽略空白', () => {
  const bl = parseBlocklist('# 註解\n\n壞詞\nBadWord\n');
  assert.deepEqual(bl, ['壞詞', 'badword']);
  assert.equal(sanitizeNickname('我是壞詞啦', 'abc', bl), 'abc');
  assert.equal(sanitizeNickname('Bad Word', 'abc', bl), 'abc');
  assert.equal(sanitizeNickname('好詞', 'abc', bl), '好詞');
});

// ---- 假的 GraphQL：分頁 ----
function fakeGql(all, { pageSize = 2, cpage = 3 } = {}) {
  const calls = [];
  const gql = async (q, v) => {
    calls.push(q === Q_DISCUSSIONS ? 'discussions' : q === Q_MORE_COMMENTS ? 'more' : 'other');
    if (q === Q_DISCUSSIONS) {
      const start = v.after ? Number(v.after) : 0, slice = all.slice(start, start + pageSize);
      return { repository: { id: 'REPO', discussionCategories: { nodes: [{ id: 'CAT', name: 'Announcements', slug: 'announcements' }] },
        discussions: { pageInfo: { hasNextPage: start + pageSize < all.length, endCursor: String(start + pageSize) },
          nodes: slice.map((d) => ({ ...d, comments: { nodes: d.comments.slice(0, cpage), pageInfo: { hasNextPage: d.comments.length > cpage, endCursor: String(cpage) } } })) } } };
    }
    if (q === Q_MORE_COMMENTS) {
      const d = all.find((x) => x.id === v.id), s = Number(v.after);
      return { node: { comments: { nodes: d.comments.slice(s, s + cpage), pageInfo: { hasNextPage: s + cpage < d.comments.length, endCursor: String(s + cpage) } } } };
    }
    throw new Error('unexpected');
  };
  return { gql, calls };
}

test('分頁：討論 5 篇分 3 頁、單篇 8 則留言分 3 頁，全部讀到', async () => {
  const many = Array.from({ length: 8 }, (_, i) => cm('u' + (i % 2)));
  const all = [ann(1, '/qa/a/', many), ann(2, '/qa/b/', [cm('u1')]), ann(3, '/qa/c/', []), ann(4, '/qa/d/', [cm('u2')]), registry([])];
  const { gql, calls } = fakeGql(all);
  const r = await fetchAll(gql, 'o', 'r');
  assert.equal(r.discussions.length, 5);
  assert.equal(r.discussions[0].comments.length, 8);
  assert.equal(calls.filter((c) => c === 'discussions').length, 3);
  assert.equal(calls.filter((c) => c === 'more').length, 2);
});

test('計算：每頁留言、Q&A 別人的問題、自問自答不算、被選為解答 +3、登記處不算', () => {
  const ds = [
    ann(1, '/qa/a/', [cm('amy'), cm('amy'), cm('bob')]),
    qa(2, 'carl', [cm('amy', 'x', { isAnswer: true }), cm('carl'), cm('bob')]),
    qa(3, 'amy', [cm('amy', 'x', { isAnswer: true })]),            // 自己的問題：不算回答、不算解答
    registry([cm('bob', '暱稱：鮑勃 顏色：薄荷綠'), cm('bob', '大家好')]),
  ];
  const out = compute({ discussions: ds, now: new Date('2026-11-05T00:00:00Z') });
  const amy = out.people.find((p) => p.login === 'amy'), bob = out.people.find((p) => p.login === 'bob');
  assert.equal(amy.answers, 3); assert.equal(amy.accepted, 1); assert.equal(amy.level, 1 + 3 + 3);
  assert.equal(bob.answers, 2); assert.equal(bob.level, 3);
  assert.equal(bob.nickname, '鮑勃'); assert.equal(bob.color, 'mint');   // 登記處留言不算回答；「大家好」無效，沿用前一則
  assert.equal(out.people.find((p) => p.login === 'carl'), undefined);     // carl 只在自己的問題裡留言
  assert.deepEqual(out.pages['qa/a'], ['amy', 'bob']);
  assert.equal(out.people[0].login, 'amy');
  assert.ok(amy.avatar.includes('amy'));
});

test('登記取每個人最新一則有效的', () => {
  const ds = [ann(1, 'p', [cm('amy')]), registry([
    cm('amy', '暱稱：舊', { createdAt: '2026-11-01T00:00:00Z' }),
    cm('amy', '暱稱：新 顏色：天空藍', { createdAt: '2026-11-03T00:00:00Z' }),
    cm('amy', '哈囉', { createdAt: '2026-11-04T00:00:00Z' }),
  ])];
  const a = compute({ discussions: ds }).people.find((p) => p.login === 'amy');
  assert.equal(a.nickname, '新'); assert.equal(a.color, 'sky');
});

test('超級距降級＋blocklist 走完整計算', () => {
  const ds = [ann(1, 'p', [cm('amy')]), registry([cm('amy', '暱稱：壞詞王 顏色：糖漿')])];
  const a = compute({ discussions: ds, blocklist: ['壞詞'] }).people.find((p) => p.login === 'amy');
  assert.equal(a.nickname, 'amy'); assert.equal(a.color, 'pink');   // 1+1=2 級：流動色降回單色預設
});

test('alanis6v6 特例：固定太空葡萄柚、彩虹、3 級；不上榜、不進熱心解答者；就算沒留言也在名單', () => {
  const ds = [ann(1, '/qa/a/', [cm('alanis6v6'), cm('alanis6v6'), cm('amy')]), registry([cm('alanis6v6', '暱稱：亂改 顏色：pink')])];
  const out = compute({ discussions: ds });
  const h = out.people.find((p) => p.login === 'alanis6v6');
  assert.deepEqual([h.nickname, h.color, h.level, h.host], ['太空葡萄柚', 'rainbow', 3, true]);
  assert.equal(out.people[out.people.length - 1].login, 'alanis6v6');
  assert.deepEqual(out.pages['qa/a'], ['amy']);
  const none = compute({ discussions: [] });
  assert.equal(none.people.length, 1);
});

test('機器人帳號不算', () => {
  const out = compute({ discussions: [ann(1, 'p', [cm('github-actions[bot]'), cm('giscus[bot]'), { body: 'x', author: null }])] });
  assert.equal(out.people.length, 1);   // 只剩站長
});

test('找不到名牌登記處：不 throw、不建討論（沒有任何 mutation），當作沒有登記資料', async () => {
  const a = fakeGql([ann(1, 'p', [cm('amy', '暱稱：沒人看')])]);
  let out = null;
  const r = await runBot({ gql: a.gql, owner: 'o', name: 'r', blocklistText: '', readOld: async () => null, write: async (t) => { out = JSON.parse(t); } });
  assert.equal(r.registryFound, false); assert.equal(r.wrote, true);
  assert.equal(out.registryUrl, null);
  assert.equal(out.people.find((p) => p.login === 'amy').nickname, 'amy');
  assert.ok(!a.calls.includes('other'));
});

test('registryNumber 可直接指定登記處（不看分類與標題）', async () => {
  const odd = disc({ number: 5, title: '隨便', category: { slug: 'general', name: 'General' }, comments: [cm('amy', '暱稱：艾咪')] });
  const all = [ann(1, 'p', [cm('amy')]), odd];
  let out = null;
  const run = (registryNumber) => runBot({ gql: fakeGql(all).gql, owner: 'o', name: 'r', blocklistText: '', readOld: async () => null, write: async (t) => { out = JSON.parse(t); }, registryNumber });
  await run('5');
  assert.equal(out.people.find((p) => p.login === 'amy').nickname, '艾咪');
  assert.ok(out.registryUrl.endsWith('/5'));
  await run('999');   // 編號不存在 → 當作沒登記資料，不 throw
  assert.equal(out.registryUrl, null);
  await run('');
  assert.equal(out.registryUrl, null);
});

test('butter 鵝黃：單色、1 級可選、中英文名都認得；不是保留色', () => {
  const b = COLORS.find((c) => c.id === 'butter');
  assert.deepEqual([b.name, b.tier], ['鵝黃', 0]);
  assert.equal(findColor('鵝黃').id, 'butter');
  assert.equal(findColor('Butter').id, 'butter');
  assert.equal(resolveColor('鵝黃', 1), 'butter');
  assert.equal(resolveColor('butter', 9), 'butter');
  assert.equal(parseRegistration('暱稱：鹿餅 顏色：鵝黃').color, '鵝黃');
  const ds = [ann(1, 'p', [cm('amy')]), registry([cm('amy', '暱稱：鹿餅 顏色：鵝黃')])];
  const a = compute({ discussions: ds }).people.find((p) => p.login === 'amy');
  assert.deepEqual([a.nickname, a.color, a.level], ['鹿餅', 'butter', 2]);
});

test('內容沒變不寫檔（不看 updatedAt）；變了才寫', async () => {
  const all = [ann(1, '/qa/a/', [cm('amy')]), registry([cm('amy', '暱稱：艾咪')])];
  let file = null, writes = 0;
  const run = (now) => runBot({ gql: fakeGql(all).gql, owner: 'o', name: 'r', blocklistText: '', readOld: async () => file, write: async (t) => { file = t; writes++; }, now });
  assert.equal((await run(new Date('2026-11-05T00:00:00Z'))).wrote, true);
  assert.equal((await run(new Date('2026-11-06T00:00:00Z'))).wrote, false);   // 只有時間不同
  assert.equal(writes, 1);
  all[0].comments.push(cm('amy'));
  assert.equal((await run(new Date('2026-11-07T00:00:00Z'))).wrote, true);
  assert.equal(writes, 2);
  assert.equal(sameContent('壞掉的json', {}), false);
});

test('別人在 Q&A 開同名討論串不算登記處', () => {
  const fake = { ...qa(7, 'evil', [cm('amy', '暱稱：被綁架')]), title: '名牌登記處' };
  const out = compute({ discussions: [ann(1, 'p', [cm('amy')]), fake] });
  assert.equal(out.registryUrl, null);
  assert.equal(out.people.find((p) => p.login === 'amy').nickname, 'amy');
  assert.deepEqual(parseBlocklist('\u3000\n壞'), ['壞']);
});
