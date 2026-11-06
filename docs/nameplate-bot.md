# 知識+ 名牌機器人

跑在 **alanis6v6/spacegrapefruit-qa** 這個 repo（不是網站 repo）。
機器人做的事：讀所有討論與留言 → 算每個人的回答數、等級 → 讀「名牌登記處」裡的暱稱／顏色登記 → 把結果寫成 `data/leaderboard.json`。網站 /qa/ 會讀這個檔顯示排行榜與「本題熱心解答者」。

## 安裝後要做的（機器人已經在 repo 根目錄，不用再上傳）

檔案位置：`.github/workflows/nameplate.yml`、`scripts/`、`blocklist.txt`、`package.json`、`docs/nameplate-bot.md`（這份）。

1. **Settings** → **Actions** → **General** → **Workflow permissions**：選 **Read and write permissions** 後 Save（workflow 檔寫了 `contents: write`，repo 設定若是 Read only 會被壓下來）。
2. **Actions** 分頁若出現「Workflows aren't being run…」，按 **I understand my workflows, go ahead and enable them**。
3. 到 **Discussions** → **New discussion**，分類選 **Announcements**，標題剛好打 `名牌登記處`，內文寫登記格式（見下）。**機器人不會自己建這篇**（不會在討論區發文、留言、建串）。
4. （可選，更保險）把這篇的編號（網址最後的數字）填進 `.github/workflows/nameplate.yml` 的 `REGISTRY_DISCUSSION_NUMBER`；留空就是自動找。
5. **Actions** → **名牌登記與等級計算** → **Run workflow**，等綠勾；repo 會多出 `data/leaderboard.json`。
6. 打開 https://raw.githubusercontent.com/alanis6v6/spacegrapefruit-qa/main/data/leaderboard.json 看得到文字就對（網站讀這個網址）。

權限：`contents: write`（把名單 commit 回來）、`discussions: read`（只讀）。

## 本機只讀試跑（dry-run）

```
GITHUB_TOKEN="$(gh auth token)" GITHUB_REPOSITORY=alanis6v6/spacegrapefruit-qa node scripts/run.mjs --dry-run
```
只讀 API，把名單 JSON 印到 stdout（說明文字走 stderr），不寫檔、不 commit。token 只放在環境變數，不要寫進檔案。

## 題目清單 `data/questions.json`

同一次跑、同一次 commit 還會多寫 `data/questions.json`，給網站畫題目列表與站內問題頁（頁面底下嵌 giscus 讓人在網頁上回答）。網址：https://raw.githubusercontent.com/alanis6v6/spacegrapefruit-qa/main/data/questions.json

```
{ "updatedAt": "ISO 時間", "questions": [ { ... }, ... ] }   // 新的在前（createdAt 由新到舊）
```

| 欄位 | 說明 |
|---|---|
| `number` / `url` | 討論編號與網址 |
| `title` | 原標題（含 `[SillyTavern]` 前綴，不改） |
| `tags` | 標題**開頭**的 `[XXX]`，可多個；沒有就 `[]` |
| `category` / `categorySlug` | 分類名稱／slug（`Q&A`／`q-a` 或 `Announcements`／`announcements`） |
| `author` | `{ login, avatar }`；帳號被刪＝`ghost` |
| `createdAt` | 討論建立時間 |
| `bodyHTML` | GitHub GraphQL 的 `bodyHTML`（GitHub 已清理過，不是自己轉的） |
| `answers` | 頂層留言數，**不算發問人自己的留言**（回覆串裡的回覆不算） |
| `answered` / `answerAuthor` | Q&A 的 `isAnswered`／被選為解答那則的作者；非 Q&A 固定 `false`／`null` |
| `pagePath` | 只有「頁面串」才有：Announcements 裡標題是網站頁面路徑的討論（例 `qa/sillytavern-railway-to-docker/`，giscus 用 pathname 對應） |

**收哪些**：Q&A 分類全部；加上 Announcements 裡標題是頁面路徑的（沒空白、至少一個 `/`、只含網址字元）。「名牌登記處」與其他公告不收。

**giscus 自動開的討論**（站內發問會這樣產生）：作者 login 是 `giscus` 開頭或 `[bot]` 結尾，且內文含 giscus 標記 `<!-- sha1: ... -->`（函式 `isGiscusDiscussion`）。這種**Q&A 分類**的討論，題目內容（`bodyHTML`）與發問人（`author`）改用**第一則頂層留言**的，`answers` 不算那一則。頁面串（Announcements）內文是頁面介紹，不換。還沒人留言時維持原樣。

內容沒變（不看 `updatedAt`）就不重寫、不 commit。dry-run 會在 stderr 印題數與每題 number／title／answers 摘要，不寫檔。

## 怎麼找到「名牌登記處」

1. 若設了環境變數 `REGISTRY_DISCUSSION_NUMBER`，就用那個編號的討論。
2. 否則找 **Announcements 分類**、標題去掉前後空白後剛好是「名牌登記處」的討論。別的分類同名不算。
3. 找不到＝沒有登記資料，所有人用預設暱稱（帳號）與預設顏色，照常算完。

## 規則

- 回答數＝在 Announcements（每頁留言）留的留言＋在 Q&A「別人的問題」底下的留言。只算直接留言，不算回覆串裡的回覆；自己的問題底下的留言不算；機器人帳號不算。
- 被選為解答（Q&A 的 isAnswer）每次另加；自己問題的解答不算。
- **等級＝1＋回答數＋被選為解答次數×3**
- 顏色依等級開放：1–2 級單色 6 種（含鵝黃）；3–5 級再加兩色漸層 4 組；6 級以上再加流動彩條 3 組。選超過等級的、不存在的、或「彩虹」「月光」，自動給你這個等級的預設（單色＝葡萄柚粉、漸層＝日落、流動＝糖漿）。沒登記的人也是拿預設。
- 暱稱最多 12 字，去掉前後空白。含 `blocklist.txt` 裡任何一個詞（一行一個，不分大小寫、忽略空白）就不用暱稱，改顯示 GitHub 帳號。blocklist 要自己加，直接在 GitHub 網頁上編輯那個檔就行。
- **alanis6v6** 固定顯示「太空葡萄柚」、彩虹、3 級；不參與排名（網站排行榜與熱心解答者都不列她）。月光（知識長）不會自動給任何人。
- 排名依序比：等級、被選為解答次數、回答數、帳號。網站顯示前 10 名。

## 鵝黃（butter）

單色、1 級起可選，登記時可寫「鵝黃」或 `butter`。網站要新增 `.tag-butter`：
- 日間 `oklch(52% .11 85)`（≈ #866300），對淺色卡片底 #f5eefe 對比 4.91:1
- 夜間 `oklch(88% .12 95)`（≈ #f0d777），對 #1b1426 對比 12.5:1

## 什麼時候會跑

有新討論／留言／編輯／刪除／被選為解答，以及每天一次（UTC 03:17）。內容沒變（不算更新時間）就不會 commit。只用 Actions 自動給的 `GITHUB_TOKEN`，不需要任何金鑰。

## 本機測試

`node --test scripts/nameplate.test.mjs`（需要 Node 20 以上，不用裝任何套件）。
