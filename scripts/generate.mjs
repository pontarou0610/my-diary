/**
 * Ponjiro の日記を AI / Pexels 付きで生成するスクリプト
 * node scripts/generate.mjs
 */
import { mkdir, writeFile, access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

async function loadAIModelConfig(repoRoot) {
  const configPath = path.join(repoRoot, 'config', 'ai-model.json')
  try {
    const content = await readFile(configPath, 'utf8')
    const config = JSON.parse(content)
    const defaultModel = config.openai.defaultModel
    const modelConfig = config.openai.models[defaultModel]
    return {
      defaultModel,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature
    }
  } catch (e) {
    console.warn('設定ファイルの読み込みに失敗:', e.message)
    return { defaultModel: 'gpt-4o', maxTokens: 1600, temperature: 0.9 }
  }
}


function formatTokyoParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  return { yyyy: parts.year, mm: parts.month, dd: parts.day }
}

function formatTokyoWeekdayJP(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    weekday: 'long'
  })
  return fmt.format(date)
}

function toDateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dateKeyFromDateUTC(date) {
  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

function utcDateFromParts(yyyy, mm, dd) {
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)))
}

function seedFromDateKey(dateKey) {
  let h = 0x811c9dc5
  for (const ch of dateKey) {
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193)
  }
  return h >>> 0
}

function makeSeededRandom(seed) {
  let x = seed || 1
  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return (x >>> 0) / 0x100000000
  }
}

function pickFrom(rng, arr) {
  if (!arr.length) return null
  return arr[Math.floor(rng() * arr.length)]
}

function calcVernalEquinoxDay(year) {
  return Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4)
}

function calcAutumnEquinoxDay(year) {
  return Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4)
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const offset = (weekday - first.getUTCDay() + 7) % 7
  const day = 1 + offset + 7 * (nth - 1)
  return toDateKey(year, month, day)
}

function buildHolidaySet(year) {
  const base = new Set()
  const add = (m, d) => base.add(toDateKey(year, m, d))
  add(1, 1)
  base.add(nthWeekdayOfMonth(year, 1, 1, 2))
  add(2, 11)
  add(2, 23)
  add(3, calcVernalEquinoxDay(year))
  add(4, 29)
  add(5, 3)
  add(5, 4)
  add(5, 5)
  base.add(nthWeekdayOfMonth(year, 7, 1, 3))
  add(8, 11)
  base.add(nthWeekdayOfMonth(year, 9, 1, 3))
  add(9, calcAutumnEquinoxDay(year))
  base.add(nthWeekdayOfMonth(year, 10, 1, 2))
  add(11, 3)
  add(11, 23)

  const holidays = new Set(base)
  const baseSorted = [...base].sort()
  for (const key of baseSorted) {
    const d = utcDateFromParts(...key.split('-'))
    if (d.getUTCDay() === 0) {
      const sub = new Date(d)
      do { sub.setUTCDate(sub.getUTCDate() + 1) } while (holidays.has(dateKeyFromDateUTC(sub)))
      holidays.add(dateKeyFromDateUTC(sub))
    }
  }

  const cursor = new Date(Date.UTC(year, 0, 1))
  while (cursor.getUTCFullYear() === year) {
    const key = dateKeyFromDateUTC(cursor)
    if (!holidays.has(key)) {
      const prev = new Date(cursor); prev.setUTCDate(prev.getUTCDate() - 1)
      const next = new Date(cursor); next.setUTCDate(next.getUTCDate() + 1)
      if (holidays.has(dateKeyFromDateUTC(prev)) && holidays.has(dateKeyFromDateUTC(next))) {
        holidays.add(key)
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return holidays
}

const holidayCache = new Map()

function isJapaneseHoliday(date) {
  const year = date.getUTCFullYear()
  if (!holidayCache.has(year)) {
    holidayCache.set(year, buildHolidaySet(year))
  }
  const set = holidayCache.get(year)
  return set.has(dateKeyFromDateUTC(date))
}

function describeDayInfo(parts, weekdayJP) {
  const { yyyy, mm, dd } = parts
  const dateKey = `${yyyy}-${mm}-${dd}`
  const utcDate = utcDateFromParts(yyyy, mm, dd)
  const weekdayEn = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(utcDate)
  const isWeekend = utcDate.getUTCDay() === 0 || utcDate.getUTCDay() === 6
  const isHoliday = isJapaneseHoliday(utcDate)
  const isWorkday = !isWeekend && !isHoliday
  const dayKindJP = isHoliday ? '祝日' : isWeekend ? '週末' : '平日'
  const seed = seedFromDateKey(dateKey)
  const rng = makeSeededRandom(seed ^ 0x9e3779b9)
  const focus = pickFrom(
    rng,
    isWorkday
      ? [
        '会議で拾った小技', '朝の段取り', '資料づくりの工夫', 'チームとの雑談', 'リモート環境整備',
        '小休憩の取り方', '進捗の言語化', '短時間集中のコツ', '相手の意図を汲む質問', 'タスクの手放し方',
        '障害対応の振り返り', '資料の再利用メモ', 'レビュー観点の棚卸し', '依頼の優先度付け', '朝イチの深掘りメモ'
      ]
      : isHoliday
        ? [
          '連休モードのゆるさ', '外に出た匂いと音', '家族時間の濃さ', 'ちょっとした贅沢', '休み中の学び',
          '近所の空気を吸う', '家事で汗をかく', 'ゆっくり眠る', '気持ちのリセット', '足元のストレッチ',
          '午後の昼寝', '図書館やカフェの静けさ', '買い物の行列', 'イベント帰りの疲労感', '普段掃除しない場所の片付け'
        ]
        : [
          '家事と子どもの会話', '週末バイトの裏話', '趣味のレビュー', '食事づくりの小技', '近所の空気感',
          '買い出しの工夫', 'スキマ時間の休息', '家の片付け手順', '子どもの習慣づくり', '夫婦のゆるトーク',
          '夜の散歩で頭をリセット', 'お風呂掃除で汗をかく', '夕飯の味付け実験', '子どもの宿題見守り', '家計相談のミニ会議'
        ]
  ) || '日常の細部'
  const tone = pickFrom(rng, ['コミカル', '素朴', 'ちょい真面目', 'あっさり', 'へとへと', 'ゆるふわ', 'てきぱき', '淡々', 'ゆったり']) || '素朴'
  return { dateKey, utcDate, weekdayEn, weekdayJP, isWeekend, isHoliday, isWorkday, dayKindJP, focus, tone }
}

function maskPrivacy(text) {
  if (text === null || text === undefined) return ''
  const s = String(text)
  return s
    .replace(/[\w.-]+@[\w.-]+/g, '***@***')
    .replace(/\+?\d[\d\-\s]{8,}\d/g, '***-****-****')
}

function wrapForMarkdown(text) {
  if (!text) return ''
  const paras = String(text).split(/\r?\n/).map(p => p.trim()).filter(Boolean)
  const out = []
  for (const para of paras) {
    const sentences = []
    let buf = ''
    for (const ch of para) {
      buf += ch
      if ('。．！？!?'.includes(ch)) {
        sentences.push(buf.trim())
        buf = ''
      }
    }
    if (buf.trim()) sentences.push(buf.trim())
    if (sentences.length === 0) sentences.push(para.trim())
    out.push(sentences.join('\n'))
  }
  return out.join('\n\n')
}

async function fileExists(p) {
  try { await access(p, constants.F_OK); return true } catch { return false }
}

async function readTitleFromPost(absFile) {
  try {
    const txt = await readFile(absFile, 'utf8')
    const m = txt.match(/title\s*=\s*"([^"]+)"/)
    return m ? m[1] : path.basename(absFile)
  } catch {
    return path.basename(absFile)
  }
}

async function resolvePostInfo(repoRoot, dateKey) {
  const [yyyy, mm, dd] = dateKey.split('-')
  const relDir = path.join('content', 'posts', yyyy, mm, dd)
  const absFile = path.join(repoRoot, relDir, `${dateKey}.md`)
  if (!(await fileExists(absFile))) return null
  const title = await readTitleFromPost(absFile)
  const relLink = `/posts/${yyyy}/${mm}/${dd}/`
  return { dateKey, title, relLink, absFile }
}

function rangeDatesUTC(startUTC, endUTC) {
  const out = []
  const cursor = new Date(startUTC)
  while (cursor.getTime() <= endUTC.getTime()) {
    out.push(new Date(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

async function collectPostsInRange(repoRoot, startUTC, endUTC) {
  const dates = rangeDatesUTC(startUTC, endUTC)
  const items = []
  for (const d of dates) {
    const info = await resolvePostInfo(repoRoot, dateKeyFromDateUTC(d))
    if (info) items.push(info)
  }
  return items
}

function startOfWeekMondayUTC(dateUTC) {
  const dow = dateUTC.getUTCDay() // 0=Sun
  const diff = (dow + 6) % 7 // days since Monday
  const monday = new Date(dateUTC)
  monday.setUTCDate(monday.getUTCDate() - diff)
  return monday
}

function isLastDayOfMonthUTC(dateUTC) {
  const next = new Date(dateUTC)
  next.setUTCDate(next.getUTCDate() + 1)
  return next.getUTCMonth() !== dateUTC.getUTCMonth()
}

async function generateWeeklySummary(now, repoRoot) {
  const parts = formatTokyoParts(now)
  const todayUTC = utcDateFromParts(parts.yyyy, parts.mm, parts.dd)
  if (todayUTC.getUTCDay() !== 1) return // 月曜のみ生成

  const thisMonday = startOfWeekMondayUTC(todayUTC)
  const prevMonday = new Date(thisMonday); prevMonday.setUTCDate(prevMonday.getUTCDate() - 7)
  const prevSunday = new Date(thisMonday); prevSunday.setUTCDate(prevSunday.getUTCDate() - 1)

  const weekLabel = `${dateKeyFromDateUTC(prevMonday)}〜${dateKeyFromDateUTC(prevSunday)}`
  const slug = `week-${dateKeyFromDateUTC(prevMonday)}-${dateKeyFromDateUTC(prevSunday)}`
  const relDir = path.join('content', 'posts', String(prevSunday.getUTCFullYear()), 'weekly')
  const absDir = path.join(repoRoot, relDir)
  await mkdir(absDir, { recursive: true })
  const absFile = path.join(absDir, `${slug}.md`)
  if (await fileExists(absFile)) return

  const posts = await collectPostsInRange(repoRoot, prevMonday, prevSunday)
  if (!posts.length) return

  const title = `週次まとめ ${weekLabel}`
  const fm = [
    '+++',
    `title = "${title}"`,
    `date = ${dateKeyFromDateUTC(todayUTC)}T09:00:00+09:00`,
    'draft = false',
    'tags = ["週次まとめ", "日記ダイジェスト"]',
    'categories = ["まとめ"]',
    '+++'
  ].join('\n')

  const list = posts.map(p => `- ${p.dateKey}: [${p.title}](${p.relLink})`).join('\n') || '今週の記事はまだありませんでした。'
  const bodyParts = [
    `今週のまとめ（${weekLabel}）`,
    `- 投稿数: ${posts.length}件`,
    '',
    '## ハイライト',
    list,
    '',
    '## 来週に向けたメモ',
    '- 仕事: 朝イチで重めのタスクを前倒しする。',
    '- お金: 固定費チェックは週末の買い出し前に10分。',
    '- 子育て: 1人ずつ5分トークの時間を作る。',
    '- 趣味/休息: スキマ時間のスマホを15分だけ読書・音声学習に振り替える。'
  ]
  const content = `${fm}\n\n${bodyParts.join('\n')}\n`
  await writeFile(absFile, content, 'utf8')
  console.log('Created weekly summary:', path.relative(repoRoot, absFile))
}

async function generateMonthlySummary(now, repoRoot) {
  const parts = formatTokyoParts(now)
  if (parts.dd !== '01') return // 月初のみ生成
  const monthStart = utcDateFromParts(parts.yyyy, parts.mm, '01')
  const prevMonthEnd = new Date(monthStart); prevMonthEnd.setUTCDate(prevMonthEnd.getUTCDate() - 1)
  const prevMonthStart = new Date(Date.UTC(prevMonthEnd.getUTCFullYear(), prevMonthEnd.getUTCMonth(), 1))

  const label = `${prevMonthStart.getUTCFullYear()}年${String(prevMonthStart.getUTCMonth() + 1).padStart(2, '0')}月`
  const slug = `month-${prevMonthStart.getUTCFullYear()}-${String(prevMonthStart.getUTCMonth() + 1).padStart(2, '0')}`
  const relDir = path.join('content', 'posts', String(prevMonthStart.getUTCFullYear()), 'monthly')
  const absDir = path.join(repoRoot, relDir)
  await mkdir(absDir, { recursive: true })
  const absFile = path.join(absDir, `${slug}.md`)
  if (await fileExists(absFile)) return

  const posts = await collectPostsInRange(repoRoot, prevMonthStart, prevMonthEnd)
  if (!posts.length) return

  const title = `月次まとめ ${label}`
  const fm = [
    '+++',
    `title = "${title}"`,
    `date = ${parts.yyyy}-${parts.mm}-01T09:30:00+09:00`,
    'draft = false',
    'tags = ["月次まとめ", "日記ダイジェスト"]',
    'categories = ["まとめ"]',
    '+++'
  ].join('\n')

  const list = posts.map(p => `- ${p.dateKey}: [${p.title}](${p.relLink})`).join('\n')
  const bodyParts = [
    `${label}のまとめ`,
    `- 投稿数: ${posts.length}件`,
    '',
    '## 月間ハイライト',
    list,
    '',
    '## 振り返りメモ',
    '- 仕事: 短時間で区切るタスク管理を徹底し、振り返りを週次で仕込む。',
    '- お金: 教育費と固定費の見直しを1回以上実施。レシート入力は即日。',
    '- 子育て: 個別時間と雑談タイムを意識して確保。',
    '- 体調/趣味: 睡眠と運動を優先し、ゲーム/マンガはご褒美時間に設定。'
  ]
  const content = `${fm}\n\n${bodyParts.join('\n')}\n`
  await writeFile(absFile, content, 'utf8')
  console.log('Created monthly summary:', path.relative(repoRoot, absFile))
}

// --- v2: 日曜夜と月末夜に生成する版（上書き定義） ---
async function generateWeeklySummary(now, repoRoot, dayInfo) {
  if (dayInfo.weekdayJP !== '日曜日') return
  const todayUTC = dayInfo.utcDate
  const weekStart = startOfWeekMondayUTC(todayUTC)
  const weekEnd = new Date(todayUTC)

  const weekLabel = `${dateKeyFromDateUTC(weekStart)}～${dateKeyFromDateUTC(weekEnd)}`
  const slug = `week-${dateKeyFromDateUTC(weekStart)}-${dateKeyFromDateUTC(weekEnd)}`
  const relDir = path.join('content', 'posts', String(weekEnd.getUTCFullYear()), 'weekly')
  const absDir = path.join(repoRoot, relDir)
  await mkdir(absDir, { recursive: true })
  const absFile = path.join(absDir, `${slug}.md`)
  if (await fileExists(absFile)) return

  const posts = await collectPostsInRange(repoRoot, weekStart, weekEnd)
  if (!posts.length) return

  const title = `週次まとめ ${weekLabel}`
  const fm = [
    '+++',
    `title = "${title}"`,
    `date = ${dateKeyFromDateUTC(todayUTC)}T22:00:00+09:00`,
    'draft = false',
    'tags = ["週次まとめ", "日記ダイジェスト"]',
    'categories = ["まとめ"]',
    '+++'
  ].join('\n')

  const list = posts.map(p => `- ${p.dateKey}: [${p.title}](${p.relLink})`).join('\n') || '今週の記事はまだありませんでした。'
  const bodyParts = [
    `今週のまとめ（${weekLabel}）`,
    `- 投稿数: ${posts.length}件`,
    '',
    '## ハイライト',
    list,
    '',
    '## 来週に向けたメモ',
    '- 仕事: 朝イチで重めのタスクを前倒しする。',
    '- お金: 固定費チェックは週末の買い出し前に10分。',
    '- 子育て: 1人ずつ5分トークの時間を作る。',
    '- 趣味/休息: スキマ時間のスマホを15分だけ読書・音声学習に振り替える。'
  ]
  const content = `${fm}\n\n${bodyParts.join('\n')}\n`
  await writeFile(absFile, content, 'utf8')
  console.log('Created weekly summary:', path.relative(repoRoot, absFile))
}

async function generateMonthlySummary(now, repoRoot, dayInfo) {
  const todayUTC = dayInfo.utcDate
  if (!isLastDayOfMonthUTC(todayUTC)) return

  const monthStart = new Date(Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), 1))
  const monthEnd = new Date(todayUTC)

  const label = `${monthStart.getUTCFullYear()}年${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}月`
  const slug = `month-${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`
  const relDir = path.join('content', 'posts', String(monthStart.getUTCFullYear()), 'monthly')
  const absDir = path.join(repoRoot, relDir)
  await mkdir(absDir, { recursive: true })
  const absFile = path.join(absDir, `${slug}.md`)
  if (await fileExists(absFile)) return

  const posts = await collectPostsInRange(repoRoot, monthStart, monthEnd)
  if (!posts.length) return

  const title = `月次まとめ ${label}`
  const fm = [
    '+++',
    `title = "${title}"`,
    `date = ${dateKeyFromDateUTC(todayUTC)}T22:30:00+09:00`,
    'draft = false',
    'tags = ["月次まとめ", "日記ダイジェスト"]',
    'categories = ["まとめ"]',
    '+++'
  ].join('\n')

  const list = posts.map(p => `- ${p.dateKey}: [${p.title}](${p.relLink})`).join('\n')
  const bodyParts = [
    `${label}のまとめ`,
    `- 投稿数: ${posts.length}件`,
    '',
    '## 月間ハイライト',
    list,
    '',
    '## 振り返りメモ',
    '- 仕事: 短時間で区切るタスク管理を徹底し、振り返りを週次で仕込む。',
    '- お金: 教育費と固定費の見直しを1回以上実施。レシート入力は即日。',
    '- 子育て: 個別時間と雑談タイムを意識して確保。',
    '- 体調/趣味: 睡眠と運動を優先し、ゲーム/マンガはご褒美時間に設定。'
  ]
  const content = `${fm}\n\n${bodyParts.join('\n')}\n`
  await writeFile(absFile, content, 'utf8')
  console.log('Created monthly summary:', path.relative(repoRoot, absFile))
}
function decideSideJobPlan(dayInfo = null, rng = Math.random) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'long' })
  const day = dayInfo?.weekdayEn || fmt.format(new Date())
  const isWeekendish = dayInfo ? (dayInfo.isWeekend || dayInfo.isHoliday) : (day === 'Saturday' || day === 'Sunday')
  const schoolEventSat = rng() < 0.3
  let planned = 'None'
  if (isWeekendish) {
    const candidates = []
    if (dayInfo?.isWeekend) candidates.push(day)
    if (!candidates.length) candidates.push('Saturday', 'Sunday')
    if (dayInfo?.isHoliday && !dayInfo.isWeekend) candidates.push('Holiday')
    planned = pickFrom(rng, candidates) || 'None'
  }
  const isTodaySJ = (day === 'Saturday' && planned === 'Saturday') || (day === 'Sunday' && planned === 'Sunday') || (planned === 'Holiday' && dayInfo?.isHoliday)
  const schoolJP = schoolEventSat ? 'あり' : 'なし'
  const pdayJP = planned === 'Saturday' ? '土曜' : planned === 'Sunday' ? '日曜' : planned === 'Holiday' ? '祝日' : 'なし'
  const todaySJJP = isTodaySJ ? 'は当日' : '違う日'
  return { schoolJP, pdayJP, todaySJJP }
}

function pickTitle(yyyy, mm, dd, quip) {
  const base = `${yyyy}-${mm}-${dd} 日記`
  const clean = maskPrivacy(quip).replace(/\s+/g, ' ').trim()
  if (!clean) return base
  let snippet = clean.slice(0, 20)
  if (clean.length > 20) snippet += '…'
  return `${base} - ${snippet}`
}

function buildPexelsQuery(hobby, parenting, work, dayInfo) {
  const extraTags = ['昼', '朝', '夕方', '夜', '雨', '晴れ', 'リビング', 'カフェ', '公園', '街', '家事', dayInfo?.focus || '', dayInfo?.dayKindJP || '']
  const extra = pickFrom(Math.random, extraTags.filter(Boolean))
  const base = `${hobby || ''} ${parenting || ''} ${work || ''} ${dayInfo?.focus || ''}`.trim()
  const query = `${base} ${extra || ''}`.trim()
  return query || '東京 日常 家庭'
}

function buildOfflineDiary(dayInfo) {
  const seed = seedFromDateKey(dayInfo.dateKey) ^ 0x5bf03635
  const rng = makeSeededRandom(seed)
  const weather = [
    '快晴だけど乾燥', '小雨で肌寒い', '曇り、加湿器フル稼働', '風が強くて洗濯物が暴れる', 'どんより、でも静か',
    '窓を開けると金木犀の名残の香り', '急に冷え込んで手がかじかむ', 'ポカポカ陽気で眠気が強い', '夕方にぱらっと通り雨',
    '湿度低めで頭が軽い', '夜は放射冷却で底冷え', '雨上がりで路面がきらきら'
  ]
  const quipFocus = [
    `今日は「${dayInfo.focus}」を意識`, 'コーヒー濃いめでスタート', '子どもたちの声で目が覚めた', 'BGMを流して気分転換',
    '朝イチで換気してリセット', '机を拭いてから気合いを入れ直し', '早起き散歩で血行を良くした', '白湯を飲んで体を温める',
    '窓からの光で目を覚ます', 'ストレッチして肩の重さを流す', '加湿器の水を足してから始業', '軽く掃除してから座る'
  ]
  const trendTopics = [
    '生成AIの新機能', '家電の新モデル', '受験シーズンの話題', 'プロ野球のストーブリーグ', 'ふるさと納税のニュース',
    'ブラックフライデーのセール', '近所の開店情報', '人気ゲームのアップデート', '朝ドラの展開', '音楽フェスのラインナップ',
    'ガジェットの新色', '防寒グッズの売れ筋', 'スイーツの新作', '自治体のイベント', 'ポイント還元キャンペーン'
  ]
  if (dayInfo.dayKindJP === '祝日') trendTopics.push('祝日のイベント情報')
  if (dayInfo.isWeekend) trendTopics.push('週末のレジャーネタ')
  const trendTopic = pickFrom(rng, trendTopics)
  const trend = pickFrom(rng, [
    `今日のトレンド（${trendTopic}）を眺める。家族の会話ネタに温存。`,
    `${trendTopic}がSNSで流れていた。今度の休みに少し試したい。`,
    `${trendTopic}のレビューを読んで物欲がむずむず。冷静に一晩寝かす。`,
    `${trendTopic}の話をさっこと共有。財布の紐を締めつつ様子見。`,
    `${trendTopic}に子どもたちも反応。予算を決めて検討する。`
  ])

  const quip = `${pickFrom(rng, weather)}。${dayInfo.dayKindJP}で${dayInfo.isWorkday ? '本業あり' : '本業休み'}の日。${pickFrom(rng, quipFocus)}。`

  const workScenes = [
    '朝イチで資料をまとめて小さくレビューを回した', 'リモート会議が続いたが雑談で空気をほぐせた', 'Slackで巻き取りつつ証券会社側の質疑を整理した',
    'タスクをポモドーロで刻んで頭を切り替えた', '端末のアップデート待ちに深呼吸タイムを挟んだ', '集中力が切れたら椅子の高さを直して姿勢リセット',
    'TODOを3つに絞って順番に片付けた', '昼食後に軽い散歩で血流アップ、午後の眠気対策', '音声メモでアイデアを拾っておいた', '社内チャットで相談し、1人で抱え込まないようにした',
    'レビューコメントを即返してボールを戻した', '画面共有でペア作業して詰まりを解消', '会議前に10分の下書きをしてから挑んだ', '資料の構成を付箋で組み替えた', '緊急対応で優先度を入れ替えた'
  ]
  const dayOffScenes = [
    '本業はお休み。洗濯を回しつつ家計簿の入力を挟んだ', '祝日で会議ゼロ。子どもと朝からコンビニ散歩', '午前はゆっくり、午後は家の片付けをメインに',
    '家族の送迎担当をしつつ昼寝も挟めた', 'バイトの段取りをノートに書き出しておいた', 'スーパーのはしごで特売を拾い歩いた',
    '録画消化しながらアイロンがけ', 'ベランダで日向ぼっこしながら読書', '子どもの宿題をとなりで眺めつつスマホで情報収集', 'キッチンの引き出しを整理してスッキリ',
    '冬物を出してクローゼットを入れ替え', '冷蔵庫の残り物でリメイク料理', 'バイトの備品チェックをしておく', '近所を散歩して季節の匂いを感じた', '昼寝後に筋トレを少しだけ'
  ]
  const work = dayInfo.isWorkday
    ? `${pickFrom(rng, workScenes)}。${pickFrom(rng, ['画面越しでも笑いを取れた', '椅子の高さを直して肩が楽になった', 'おやつ時間に家族と一言しゃべってリフレッシュ', 'メモを即残すだけで翌日の自分が助かる', '小さなタスクを刻んで達成感を積んだ'])}。`
    : `${pickFrom(rng, dayOffScenes)}。${pickFrom(rng, ['家族時間を優先できた', '近所の空気を吸ってリセット', '買い物の荷物が重くてちょっと筋トレ気分', '昼寝で体力チャージできた', '夕方にゆっくり風呂で温まった'])}。`

  const workLearning = dayInfo.isWorkday
    ? pickFrom(rng, [
      '短くてもゴールを握って会議に入ると迷子にならないと再確認', 'レビューは「一言でどこが良いか」から入ると雰囲気が柔らかい',
      '証券会社の人の質問パターンをメモしておくと返答が速い', 'Notionに決定事項を即書きするだけで翌日の自分が助かる',
      '昼前に難しいタスクを当てると意外と進むと再発見', '録画デモを先に作ると説明が楽になると学んだ', '質問を3つに絞ると議論が深まると実感']
    )
    : pickFrom(rng, [
      '休みでもメモだけ先に用意しておくと月曜の自分が楽', '体を休めるのも仕事のうち、と言い聞かせて罪悪感を減らす',
      '家事の段取りを仕事のタスク分解と同じ要領でやると早い', '子どもの予定と自分の予定を同じカレンダーにまとめると迷わない',
      '買い物リストはゾーン別に書くと迷わない']
    )

  const money = `${pickFrom(rng, ['スーパーで特売を拾う', '子どもの参考書代が響く', '水道光熱費がじわっと上昇', 'ドラッグストアで生活用品をまとめ買い', 'ポイント消化のために日用品を購入', '外食を一回減らして自炊を増やす', 'サブスクの解約候補を整理'])}。${pickFrom(rng, ['家計簿アプリにすぐ入力', 'ポイント還元日を狙って支払い', '小銭入れを軽くして気分も軽い', '買う物リストを事前に共有してブレを減らす', '値上がり品は代替品を探す'])}。`
  const moneyTip = pickFrom(rng, [
    'レシート撮影は帰宅後5分以内に済ませる', '現金払いは1日1回までと決めると無駄遣いが減る', '欲しい物は翌朝まで寝かせてから買う', '送料無料に釣られず総額を見る', 'クーポンは使う日を決めておく']
  )

  const parenting = pickFrom(rng, [
    '聖太郎は模試の復習で机にかじりつき。夜に軽く声をかけて様子見', '蓮子は吹奏楽の新曲でテンション高め。バイトの愚痴も少し聞いた',
    '連次郎丸はRoblox三昧。30分だけ一緒にプレイして区切りを作った', '家族で夕飯のメニューを決める会議を開催。意外と盛り上がる',
    '兄弟で動画を観て爆笑。音量だけは要調整', 'さっこが見つけたレシピで晩ご飯づくりを手伝った', '次男のゲーム時間を一緒にタイマーで区切った',
    'テスト前の聖太郎に夜食を差し入れ', '蓮子のバイト帰宅に合わせて風呂を温めておいた', '家族でゴミ出し当番をローテして負担分散',
    '進路の話を10分だけ真面目にした', '学校のプリント整理を一緒に片付けた', '子どものスマホ時間を一緒に管理した', '家族LINEで明日の予定を共有した'
  ])
  const dadpt = pickFrom(rng, [
    '短時間でも長男の勉強に付き添う', '笑わせ役を買って出て家の空気を柔らかくする', '連次郎丸のゲームタイムを一緒に区切る',
    '蓮子の話を遮らず最後まで聞く', 'さっこの愚痴をまず受け止める', '寝る前に5分だけでも子どもと対話',
    '家事を1つ多めに引き受けておく', 'スキンシップを意識して抱きしめる', 'ありがとうを口に出す', '自分の疲れを正直に伝えて協力を求める',
    '送迎の前後で一言ポジティブな声かけ', '子どもの成功体験を言葉にして残す'
  ])

  const hobby = pickFrom(rng, [
    'ガンダムUCエンゲージでデイリー消化。新機体の演出が渋い', 'LINEマンガで無料分を読み進める。寝落ち寸前のルーティン',
    'ピッコマで溜めてた話を一気読み。広告の合間にストレッチ', 'Spotifyで懐かしのアニソンを流しながら皿洗い',
    'YouTubeで懐かしのゲーム実況をBGMにする', '無料ガチャの結果に一喜一憂', 'マンガの続巻が気になりつつ我慢',
    'お気に入りプレイリストを整理して通勤用に備える', '新しいポッドキャストを1本試した', '昔読んだ漫画を読み返して懐かしんだ'
  ])

  const moodScore = Math.min(10, Math.max(3, (dayInfo.isWorkday ? 6 : 7) + Math.floor(rng() * 3)))
  const thanks = pickFrom(rng, [
    'さっこが温かいお茶を出してくれた', '子どもたちが皿洗いを手伝ってくれた', '近所の人が野菜をおすそ分けしてくれた',
    '好きな音楽で肩の力が抜けた', 'バイト先の人が差し入れをくれた', '家族がゴミ出しを代わってくれた', '友人からメッセージをもらった'
  ])

  const tomorrow = pickFrom(rng, [
    '朝のうちに洗濯を2回回してから集中タイムに入りたい', 'タスクを3つに絞って確実に終わらせる', '子どもの送迎前に軽く散歩して頭をクリアにする',
    '夕方は早めに風呂を沸かしてのんびりする', '早寝して翌朝のパフォーマンスを上げる', '昼休みにストレッチを挟む', '夜はスマホを遠ざけて読書する',
    '朝一番に重いタスクを片付ける', '夕方に買い出しを済ませておく'
  ])

  return { quip, work, workLearning, money, moneyTip, parenting, dadpt, hobby, mood: String(moodScore), thanks, tomorrow, trend }
}

async function main() {
  const repoRoot = process.cwd()
  const now = new Date()
  const parts = formatTokyoParts(now)
  const { yyyy, mm, dd } = parts
  const weekdayJP = formatTokyoWeekdayJP(now)
  const dayInfo = describeDayInfo(parts, weekdayJP)
  const relDir = path.join('content', 'posts', yyyy, mm, dd)
  const absDir = path.join(repoRoot, relDir)
  await mkdir(absDir, { recursive: true })

  const slug = `${yyyy}-${mm}-${dd}`
  const absFile = path.join(absDir, `${slug}.md`)
  const exists = await fileExists(absFile)

  const draft = 'false'
  const sjRng = makeSeededRandom(seedFromDateKey(dayInfo.dateKey) ^ 0x13572468)
  const { schoolJP, pdayJP, todaySJJP } = decideSideJobPlan(dayInfo, sjRng)

  const sys = `
あなたは40代の会社員「ぽん次郎」。SESで証券会社に常駐しているがフルリモート。
妻はさっこ（専業主婦気質で浪費しがち）、子どもは3人（長男:聖太郎=高3で受験期・スーパーでバイト、長女:蓮子=高1で吹奏楽部・ファミレスでバイト、次男:連次郎丸=小5で不登校気味・Roblox好き）。
趣味はスマホゲーム「機動戦士ガンダムUCエンゲージ」と、LINEマンガ/ピッコマの無料話を寝る前に読む程度。毎週どちらかの週末に日雇いのオフィス移転バイト。
スタイル: 野原ひろし風の一人称「オレ」。庶民的でユーモラス、家族への愛情と弱音がちらつくが前向きに締める。
前提:
- 日付: ${yyyy}-${mm}-${dd}（${weekdayJP} / ${dayInfo.dayKindJP}）。本業: ${dayInfo.isWorkday ? '通常勤務あり' : '休み（本業ネタは控えめ）'}。
- サイドジョブ予定: 学校行事 ${schoolJP}、日雇い予定日: ${pdayJP}、今日が日雇い当日: ${todaySJJP}。
- 今日の切り口: 「${dayInfo.focus}」。トーンは${dayInfo.tone}寄りに揺らし、日替わり感を出す。
- 土日祝日は本業は休み扱い。仕事セクションは控えめにし、家族/趣味/小仕事/休息を厚めに描く。
- 平日は仕事の学びを具体に1つ深掘り。冒頭ひとことで天気/体調/予定を触れる。
- 季節・天気・匂い・音・家事の手触りなど具体物を散らし、固有名詞や住所はぼかす。
- 同じ書き出しや文末を避け、会話・内省・レビューなど表現パターンを交互に使ってマンネリを防ぐ。
- 文字数: 本文トータルおおよそ2000〜2400文字。句点や読点で適度に改行し読みやすく。
- その日のトレンド（ジャンル不問）への短い所感を1つ入れる。
Hugoブログ用に、以下のJSON schemaで出力（目安は調整可）:
{
  "quip": "今日のひとこと。天気や体調、日雇い予定（学校行事: ${schoolJP}, 日雇い予定日: ${pdayJP}, 今日が日雇い当日: ${todaySJJP}）を絡める",
  "work": "仕事。リモート勤務、会議、業務、仕事仲間とのやりとりなど。土日祝は本業控えめ",
  "work_learning": "仕事からの学び。休みの日は次に試したいことでも可",
  "money": "お金。家計、教育費、日用品、節約/買い物、バイト代の使い道など",
  "money_tip": "お金に関する気づきやミニTips",
  "parenting": "子育て。長男・長女・次男の様子や悩み、夫婦のやりとりも含めて",
  "dad_points": "父親として意識したいこと",
  "hobby": "趣味。ガンダムUCエンゲージ、漫画（LINEマンガ/ピッコマ）、音楽など",
  "trend": "その日のトレンドへの一言所感（ニュース/ネット/買い物/地域などジャンル不問）",
  "mood": "気分。0〜10で数値。整数",
  "thanks": "感謝",
  "tomorrow": "明日の一言"
}
JSONだけを出力する。文章トーンは野原ひろし風の口調で、家族への愛情をさりげなくにじませて。
`
  const userPrompt = '上記JSON schemaどおりに、JSONだけで返してください。'

  let { quip, work, workLearning, money, moneyTip, parenting, dadpt, hobby, trend, mood, thanks, tomorrow } = buildOfflineDiary(dayInfo)

  // AI設定の読み込み（優先順位: 環境変数 > 設定ファイル）
  const aiConfig = await loadAIModelConfig(repoRoot)
  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || aiConfig.defaultModel

  if (apiKey) {
    console.log(`使用モデル: ${model} (maxTokens: ${aiConfig.maxTokens}, temperature: ${aiConfig.temperature})`)
    try {
      const body = {
        model,
        temperature: aiConfig.temperature,
        max_tokens: aiConfig.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userPrompt }
        ]
      }
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      })
      if (!resp.ok) throw new Error(`OpenAI HTTP ${resp.status}`)
      const data = await resp.json()
      const content = data.choices?.[0]?.message?.content
      try {
        const parsed = JSON.parse(content)
        if (parsed.quip) quip = parsed.quip
        if (parsed.work) work = parsed.work
        if (parsed.work_learning) workLearning = parsed.work_learning
        if (parsed.money) money = parsed.money
        if (parsed.money_tip) moneyTip = parsed.money_tip
        if (parsed.parenting) parenting = parsed.parenting
        if (parsed.dad_points) dadpt = parsed.dad_points
        if (parsed.hobby) hobby = parsed.hobby
        if (parsed.trend) trend = parsed.trend
        if (parsed.mood) mood = parsed.mood
        if (parsed.thanks) thanks = parsed.thanks
        if (parsed.tomorrow) tomorrow = parsed.tomorrow
      } catch {
        console.warn('JSON parse failed for OpenAI content')
      }
    } catch (e) {
      console.warn('OpenAI生成に失敗:', e.message)
    }
  } else {
    console.warn('OPENAI_API_KEY 未設定。テンプレートを使用します。')
  }

  let coverRel = null
  const pexKey = process.env.PEXELS_API_KEY
  if (pexKey) {
    try {
      const query = buildPexelsQuery(hobby, parenting, work, dayInfo)
      const page = Math.floor(Math.random() * 5) + 1
      const perPage = 15
      const url = `https://api.pexels.com/v1/search?per_page=${perPage}&page=${page}&orientation=landscape&query=${encodeURIComponent(query)}`
      const resp = await fetch(url, { headers: { Authorization: pexKey } })
      if (resp.ok) {
        const data = await resp.json()
        const photos = data.photos || []
        const photo = photos.length ? photos[Math.floor(Math.random() * photos.length)] : null
        const src = photo?.src?.large2x || photo?.src?.large || photo?.src?.landscape
        if (src) {
          const imgResp = await fetch(src, { headers: { Authorization: pexKey } })
          if (imgResp.ok) {
            const buf = Buffer.from(await imgResp.arrayBuffer())
            coverRel = `/posts/${yyyy}/${mm}/${dd}/cover.jpg`
            const staticDir = path.join(repoRoot, 'static', 'posts', yyyy, mm, dd)
            await mkdir(staticDir, { recursive: true })
            await writeFile(path.join(staticDir, 'cover.jpg'), buf)
          }
        }
      }
    } catch (e) {
      console.warn('Pexels取得に失敗:', e.message)
    }
  }

  const title = pickTitle(yyyy, mm, dd, quip)
  const fmLines = [
    '+++',
    `title = "${title}"`,
    `date = ${yyyy}-${mm}-${dd}T22:00:00+09:00`,
    `draft = ${draft}`,
    'tags = ["日記", "仕事", "お金", "子育て", "趣味"]',
    'categories = ["日常"]'
  ]
  if (coverRel) {
    const alt = (quip || '').replace(/"/g, '\\"')
    fmLines.push('[cover]')
    fmLines.push(`  image = "${coverRel}"`)
    fmLines.push(`  alt = "${alt}"`)
  }
  fmLines.push('+++')
  const frontMatter = fmLines.join('\n')

  const sections = {
    work: `## 仕事\n\n${wrapForMarkdown(maskPrivacy(work))}\n\n{{< learn >}}\n${wrapForMarkdown(maskPrivacy(workLearning))}\n{{< /learn >}}`,
    money: `## お金\n\n${wrapForMarkdown(maskPrivacy(money))}\n\n{{< tip >}}\n${wrapForMarkdown(maskPrivacy(moneyTip))}\n{{< /tip >}}`,
    parenting: `## 子育て\n\n${wrapForMarkdown(maskPrivacy(parenting))}\n\n{{< dadpt >}}\n${wrapForMarkdown(maskPrivacy(dadpt))}\n{{< /dadpt >}}`,
    hobby: `## 趣味\n\n${wrapForMarkdown(maskPrivacy(hobby))}`,
    trend: `## トレンドひとこと\n\n${wrapForMarkdown(maskPrivacy(trend))}`
  }

  const patterns = dayInfo.isWorkday
    ? [
      ['work', 'money', 'parenting', 'hobby', 'trend'],
      ['work', 'parenting', 'money', 'hobby', 'trend'],
      ['work', 'trend', 'money', 'parenting', 'hobby']
    ]
    : [
      ['parenting', 'work', 'money', 'hobby', 'trend'],
      ['hobby', 'parenting', 'money', 'work', 'trend'],
      ['trend', 'parenting', 'money', 'hobby', 'work']
    ]
  const prng = makeSeededRandom(seedFromDateKey(dayInfo.dateKey) ^ 0x2468ace0)
  const order = patterns[Math.floor(prng() * patterns.length)]

  const bodyParts = [`今日のひとこと: ${wrapForMarkdown(maskPrivacy(quip))}`]
  for (const key of order) {
    if (sections[key]) bodyParts.push(sections[key])
  }
  bodyParts.push(`## 気分・感謝・明日の一言\n- 気分: ${maskPrivacy(mood)}/10\n- 感謝: ${maskPrivacy(thanks)}\n- 明日の一言: ${maskPrivacy(tomorrow)}`)

  const body = bodyParts.join('\n\n')
  const content = `${frontMatter}\n\n${body}`

  if (!exists) {
    await writeFile(absFile, content, 'utf8')
    console.log('Created:', path.relative(repoRoot, absFile))
  } else {
    console.log(`Already exists: ${absFile}`)
  }

  await generateWeeklySummary(now, repoRoot, dayInfo)
  await generateMonthlySummary(now, repoRoot, dayInfo)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
