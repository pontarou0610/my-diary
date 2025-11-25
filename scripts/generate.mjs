/**
 * Ponjiro の日記を AI / Pexels 付きで生成するスクリプト
 * node scripts/generate.mjs
 */
import { mkdir, writeFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// JST の日付を取得してディレクトリ名を決める
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
  add(1, 1) // 元日
  base.add(nthWeekdayOfMonth(year, 1, 1, 2)) // 成人の日 (2nd Monday)
  add(2, 11) // 建国記念の日
  add(2, 23) // 天皇誕生日
  add(3, calcVernalEquinoxDay(year)) // 春分の日
  add(4, 29) // 昭和の日
  add(5, 3) // 憲法記念日
  add(5, 4) // みどりの日
  add(5, 5) // こどもの日
  base.add(nthWeekdayOfMonth(year, 7, 1, 3)) // 海の日 (3rd Monday)
  add(8, 11) // 山の日
  base.add(nthWeekdayOfMonth(year, 9, 1, 3)) // 敬老の日 (3rd Monday)
  add(9, calcAutumnEquinoxDay(year)) // 秋分の日
  base.add(nthWeekdayOfMonth(year, 10, 1, 2)) // スポーツの日 (2nd Monday)
  add(11, 3) // 文化の日
  add(11, 23) // 勤労感謝の日

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
      ? ['会議で拾った小技', '朝の段取り', '資料づくりの工夫', 'チームとの雑談', 'リモート仕事の環境整備']
      : isHoliday
        ? ['連休モードのゆるさ', '外に出た匂いと音', '家族時間の濃さ', 'ちょっとした贅沢', '休み中の学び']
        : ['家事と子どもの会話', '週末バイトの裏話', '趣味のレビュー', '食事づくりの小技', '近所の空気感']
  ) || '日常の細部'
  const tone = pickFrom(rng, ['コミカル', '素朴', 'ちょい真面目', 'あっさり', 'へとへと']) || '素朴'
  return { dateKey, utcDate, weekdayEn, weekdayJP, isWeekend, isHoliday, isWorkday, dayKindJP, focus, tone }
}

// メール・電話番号らしき文字を伏せ字にする
function maskPrivacy(text) {
  if (text === null || text === undefined) return ''
  const s = String(text)
  return s
    .replace(/[\w.-]+@[\w.-]+/g, '***@***')
    .replace(/\+?\d[\d\-\s]{8,}\d/g, '***-****-****')
}

// 句点などの文末記号でのみ改行する
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

// 週末バイトの予定をざっくり決める（表示用だけ）
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
  const weather = ['快晴だけど乾燥', '小雨で肌寒い', '曇り、加湿器フル稼働', '風が強くて洗濯物が暴れる', 'どんより、でも静か', '窓を開けると金木犀の名残の香り']
  const quipFocus = [
    `今日は「${dayInfo.focus}」を意識`,
    'コーヒー濃いめでスタート',
    '子どもたちの声で目が覚めた',
    'BGMを流して気分転換',
    '朝イチで換気してリセット'
  ]
  const quip = `${pickFrom(rng, weather)}。${dayInfo.dayKindJP}で${dayInfo.isWorkday ? '本業あり' : '本業休み'}の日。${pickFrom(rng, quipFocus)}。`

  const workScenes = [
    '朝イチで資料をまとめて小さくレビューを回した',
    'リモート会議が続いたが雑談で空気をほぐせた',
    'Slackで巻き取りつつ証券会社側の質疑を整理した',
    'タスクをポモドーロで刻んで頭を切り替えた',
    '端末のアップデート待ちに深呼吸タイムを挟んだ'
  ]
  const dayOffScenes = [
    '本業はお休み。洗濯を回しつつ家計簿の入力を挟んだ',
    '祝日で会議ゼロ。子どもと朝からコンビニ散歩',
    '午前はゆっくり、午後は家の片付けをメインに',
    '家族の送迎担当をしつつ昼寝も挟めた',
    'バイトの段取りをノートに書き出しておいた'
  ]
  const work = dayInfo.isWorkday
    ? `${pickFrom(rng, workScenes)}。${pickFrom(rng, ['画面越しでも笑いを取れた', '椅子の高さを直して肩が楽になった', 'おやつ時間に家族と一言しゃべってリフレッシュ'])}。`
    : `${pickFrom(rng, dayOffScenes)}。${pickFrom(rng, ['家族時間を優先できた', '近所の空気を吸ってリセット', '買い物の荷物が重くてちょっと筋トレ気分'])}。`

  const workLearning = dayInfo.isWorkday
    ? pickFrom(rng, [
      '短くてもゴールを握って会議に入ると迷子にならないと再確認',
      'レビューは「一言でどこが良いか」から入ると雰囲気が柔らかい',
      '証券会社の人の質問パターンをメモしておくと返答が速い',
      'Notionに決定事項を即書きするだけで翌日の自分が助かる'
    ])
    : pickFrom(rng, [
      '休みでもメモだけ先に用意しておくと月曜の自分が楽',
      '体を休めるのも仕事のうち、と言い聞かせて罪悪感を減らす',
      '家事の段取りを仕事のタスク分解と同じ要領でやると早い'
    ])

  const money = `${pickFrom(rng, ['スーパーで特売を拾う', '子どもの参考書代が響く', '水道光熱費がじわっと上昇', 'ドラッグストアで生活用品をまとめ買い'])}。${pickFrom(rng, ['家計簿アプリにすぐ入力', 'ポイント還元日を狙って支払い', '小銭入れを軽くして気分も軽い'])}。`
  const moneyTip = pickFrom(rng, [
    'レシート撮影は帰宅後5分以内に済ませる',
    '現金払いは1日1回までと決めると無駄遣いが減る',
    '欲しい物は翌朝まで寝かせてから買う'
  ])

  const parenting = pickFrom(rng, [
    '聖太郎は模試の復習で机にかじりつき。夜に軽く声をかけて様子見',
    '蓮子は吹奏楽の新曲でテンション高め。バイトの愚痴も少し聞いた',
    '連次郎丸はRoblox三昧。30分だけ一緒にプレイして区切りを作った',
    '家族で夕飯のメニューを決める会議を開催。意外と盛り上がる'
  ])
  const dadpt = pickFrom(rng, [
    '短時間でも長男の勉強に付き添う',
    '笑わせ役を買って出て家の空気を柔らかくする',
    '連次郎丸のゲームタイムを一緒に区切る',
    '蓮子の話を遮らず最後まで聞く'
  ])

  const hobby = pickFrom(rng, [
    'ガンダムUCエンゲージでデイリー消化。新機体の演出が渋い',
    'LINEマンガで無料分を読み進める。寝落ち寸前のルーティン',
    'ピッコマで溜めてた話を一気読み。広告の合間にストレッチ',
    'Spotifyで懐かしのアニソンを流しながら皿洗い'
  ])

  const moodScore = Math.min(10, Math.max(3, (dayInfo.isWorkday ? 6 : 7) + Math.floor(rng() * 3)))
  const thanks = pickFrom(rng, [
    'さっこが温かいお茶を出してくれた',
    '子どもたちが皿洗いを手伝ってくれた',
    '近所の人が野菜をおすそ分けしてくれた',
    '好きな音楽で肩の力が抜けた'
  ])

  const tomorrow = pickFrom(rng, [
    '朝のうちに洗濯を2回回してから集中タイムに入りたい',
    'タスクを3つに絞って確実に終わらせる',
    '子どもの送迎前に軽く散歩して頭をクリアにする',
    '夕方は早めに風呂を沸かしてのんびりする'
  ])

  return { quip, work, workLearning, money, moneyTip, parenting, dadpt, hobby, mood: String(moodScore), thanks, tomorrow }
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
  if (await fileExists(absFile)) {
    console.log(`Already exists: ${absFile}`)
    return
  }

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
  "mood": "気分。0〜10で数値。整数",
  "thanks": "感謝",
  "tomorrow": "明日の一言"
}
JSONだけを出力する。文章トーンは野原ひろし風の口調で、家族への愛情をさりげなくにじませて。
`
  const userPrompt = '上記JSON schemaどおりに、JSONだけで返してください。'

  let {
    quip,
    work,
    workLearning,
    money,
    moneyTip,
    parenting,
    dadpt,
    hobby,
    mood,
    thanks,
    tomorrow
  } = buildOfflineDiary(dayInfo)

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  if (apiKey) {
    try {
      const body = {
        model,
        temperature: 0.8,
        max_tokens: 1500,
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
        if (parsed.quip)         quip = parsed.quip
        if (parsed.work)         work = parsed.work
        if (parsed.work_learning) workLearning = parsed.work_learning
        if (parsed.money)        money = parsed.money
        if (parsed.money_tip)    moneyTip = parsed.money_tip
        if (parsed.parenting)    parenting = parsed.parenting
        if (parsed.dad_points)   dadpt = parsed.dad_points
        if (parsed.hobby)        hobby = parsed.hobby
        if (parsed.mood)         mood = parsed.mood
        if (parsed.thanks)       thanks = parsed.thanks
        if (parsed.tomorrow)     tomorrow = parsed.tomorrow
      } catch {
        console.warn('JSON parse failed for OpenAI content')
      }
    } catch (e) {
      console.warn('OpenAI生成に失敗:', e.message)
    }
  } else {
    console.warn('OPENAI_API_KEY 未設定。テンプレートを使用します。')
  }

  // ==== Pexels cover image ====
  let coverRel = null
  const pexKey = process.env.PEXELS_API_KEY
  if (pexKey) {
    try {
      const query = buildPexelsQuery(hobby, parenting, work, dayInfo)
      const page = Math.floor(Math.random() * 5) + 1 // 1〜5ページのどれか
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
    const alt = (quip || '').replace(/"/g, '\"')
    fmLines.push('[cover]')
    fmLines.push(`  image = "${coverRel}"`)
    fmLines.push(`  alt = "${alt}"`)
  }
  fmLines.push('+++')
  const frontMatter = fmLines.join('\n')

  const body =
`今日のひとこと: ${wrapForMarkdown(maskPrivacy(quip))}

## 仕事

${wrapForMarkdown(maskPrivacy(work))}

{{< learn >}}
${wrapForMarkdown(maskPrivacy(workLearning))}
{{< /learn >}}

## お金

${wrapForMarkdown(maskPrivacy(money))}

{{< tip >}}
${wrapForMarkdown(maskPrivacy(moneyTip))}
{{< /tip >}}

## 子育て

${wrapForMarkdown(maskPrivacy(parenting))}

{{< dadpt >}}
${wrapForMarkdown(maskPrivacy(dadpt))}
{{< /dadpt >}}

## 趣味

${wrapForMarkdown(maskPrivacy(hobby))}

## 気分・感謝・明日の一言
- 気分: ${maskPrivacy(mood)}/10
- 感謝: ${maskPrivacy(thanks)}
- 明日の一言: ${maskPrivacy(tomorrow)}
`

  const content = `${frontMatter}

${body}`
  await writeFile(absFile, content, 'utf8')
  console.log('Created:', path.relative(repoRoot, absFile))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
