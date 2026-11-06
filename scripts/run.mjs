// 在 GitHub Actions 裡跑：node scripts/run.mjs
// 本機只讀試跑：GITHUB_TOKEN=... GITHUB_REPOSITORY=alanis6v6/spacegrapefruit-qa node scripts/run.mjs --dry-run
//   --dry-run：只讀 API、把算出的名單印到 stdout，不寫檔、不 commit、不建任何討論。
// 只用內建 fetch 跟 GITHUB_TOKEN，沒有任何其他金鑰。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBot, summarizeQuestions } from './lib.mjs';

const dryRun = process.argv.includes('--dry-run');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.GITHUB_TOKEN;
const [owner, name] = String(process.env.GITHUB_REPOSITORY || '').split('/');
if (!token || !owner || !name) { console.error('缺 GITHUB_TOKEN 或 GITHUB_REPOSITORY（Actions 裡會自動有；本機要自己設環境變數）'); process.exit(1); }

async function gql(query, variables) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'spacegrapefruit-qa-nameplate' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new Error('GraphQL 失敗：' + (r.status) + ' ' + JSON.stringify(j.errors || j).slice(0, 400));
  return j.data;
}

const file = resolve(root, 'data/leaderboard.json');
const qfile = resolve(root, 'data/questions.json');
const res = await runBot({
  gql, owner, name,
  registryNumber: process.env.REGISTRY_DISCUSSION_NUMBER,   // 可選：直接指定登記處的討論編號；沒設就用「Announcements 分類＋標題」找
  blocklistText: await readFile(resolve(root, 'blocklist.txt'), 'utf8').catch(() => ''),
  readOld: () => readFile(file, 'utf8').catch(() => null),
  write: async (text) => {
    if (dryRun) { process.stdout.write(text); return; }
    await mkdir(dirname(file), { recursive: true }); await writeFile(file, text);
  },
  readOldQuestions: () => readFile(qfile, 'utf8').catch(() => null),
  writeQuestions: async (text) => {
    if (dryRun) return;   // dry-run 只印摘要（stderr），不寫檔
    await mkdir(dirname(qfile), { recursive: true }); await writeFile(qfile, text);
  },
});
const log = dryRun ? console.error : console.log;   // dry-run 時 stdout 只放名單 JSON
if (!res.registryFound) log('（找不到「名牌登記處」討論串，當作沒有登記資料）');
if (dryRun) log(summarizeQuestions(res.questions));
if (dryRun) log('[dry-run] 只讀，沒寫檔、沒 commit');
else log((res.wrote ? '已更新 data/leaderboard.json' : '排行榜內容沒變，不寫檔') + '；' + (res.questionsWrote ? '已更新 data/questions.json' : 'questions.json 內容沒變，不寫檔'));
