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
      ? [
        '会議で拾った小技',
        '朝の段取り',
        '資料づくりの工夫',
        'チームとの雑談',
        'リモート仕事の環境整備',
        '小休憩の取り方',
        '進捗の言語化',
        '短時間集中のコツ',
        '相手の意図を汲む質問',
        'タスクの手放し方'
      ]
      : isHoliday
        ? [
          '連休モードのゆるさ',
          '外に出た匂いと音',
          '家族時間の濃さ',
          'ちょっとした贅沢',
          '休み中の学び',
          '近所の空気を吸う',
          '家事で汗をかく',
          'ゆっくり眠る',
          '気持ちのリセット',
          '足元のストレッチ'
        ]
        : [
          '家事と子どもの会話',
          '週末バイトの裏話',
          '趣味のレビュー',
          '食事づくりの小技',
          '近所の空気感',
          '買い出しの工夫',
          'スキマ時間の休息',
          '家の片付け手順',
          '子どもの習慣づくり',
          '夫婦のゆるトーク'
        ]
  ) || '日常の細部'
  const tone = pickFrom(rng, ['コミカル', '素朴', 'ちょい真面目', 'あっさり', 'へとへと', 'ゆるふわ', 'てきぱき']) || '素朴'
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

// サイドジョブの予定をざっくり決める（表示用だけ）
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
    '快晴だけど乾燥',
    '小雨で肌寒い',
    '曇り、加湿器フル稼働',
    '風が強くて洗濯物が暴れる',
    'どんより、でも静か',
    '窓を開けると金木犀の名残の香り',
    '急に冷え込んで手がかじかむ',
    'ポカポカ陽気で眠気が強い',
    '夕方にぱらっと通り雨',
    '湿度低めで頭が軽い'
  ]
  const quipFocus = [
    `今日は「${dayInfo.focus}」を意識`,
    'コーヒー濃いめでスタート',
    '子どもたちの声で目が覚めた',
    'BGMを流して気分転換',
    '朝イチで換気してリセット',
    '机を拭いてから気合いを入れ直し',
    '早起き散歩で血行を良くした',
    '白湯を飲んで体を温める',
    '窓からの光で目を覚ます',
    'ストレッチして肩の重さを流す'
  ]
  const trendTopics = [
    '生成AIの新機能',
    '家電の新モデル',
    '受験シーズンの話題',
    'プロ野球のストーブリーグ',
    'ふるさと納税のニュース',
    'ブラックフライデーのセール',
    '近所の開店情報',
    '人気ゲームのアップデート',
    '朝ドラの展開',
    '音楽フェスのラインナップ'
  ]
  const trendTopic = pickFrom(rng, trendTopics)
  const trend = pickFrom(rng, [
    `今日のトレンド（${trendTopic}）を眺める。家族の会話ネタに温存。`,
    `${trendTopic}がSNSで流れていた。今度の休みに少し試したい。`,
    `${trendTopic}のレビューを読んで物欲がむずむず。冷静に一晩寝かす。`,
    `${trendTopic}の話をさっこと共有。財布の紐を締めつつ様子見。`
  ])

  const quip = `${pickFrom(rng, weather)}。${dayInfo.dayKindJP}で${dayInfo.isWorkday ? '本業あり' : '本業休み'}の日。${pickFrom(rng, quipFocus)}。`

  const workScenes = [
    '朝イチで資料をまとめて小さくレビューを回した',
    'リモート会議が続いたが雑談で空気をほぐせた',
    'Slackで巻き取りつつ証券会社側の質疑を整理した',
    'タスクをポモドーロで刻んで頭を切り替えた',
    '端末のアップデート待ちに深呼吸タイムを挟んだ',
    '集中力が切れたら椅子の高さを直して姿勢リセット',
    'TODOを3つに絞って順番に片付けた',
    '昼食後に軽い散歩で血流アップ、午後の眠気対策',
    '音声メモでアイデアを拾っておいた',
    '社内チャットで相談し、1人で抱え込まないようにした'
  ]
  const dayOffScenes = [
    '本業はお休み。洗濯を回しつつ家計簿の入力を挟んだ',
    '祝日で会議ゼロ。子どもと朝からコンビニ散歩',
    '午前はゆっくり、午後は家の片付けをメインに',
    '家族の送迎担当をしつつ昼寝も挟めた',
    'バイトの段取りをノートに書き出しておいた',
    'スーパーのはしごで特売を拾い歩いた',
    '録画消化しながらアイロンがけ',
    'ベランダで日向ぼっこしながら読書',
    '子どもの宿題をとなりで眺めつつスマホで情報収集',
    'キッチンの引き出しを整理してスッキリ'
  ]
  const work = dayInfo.isWorkday
    ? `${pickFrom(rng, workScenes)}。${pickFrom(rng, ['画面越しでも笑いを取れた', '椅子の高さを直して肩が楽になった', 'おやつ時間に家族と一言しゃべってリフレッシュ', 'メモを即残すだけで翌日の自分が助かる'])}。`
    : `${pickFrom(rng, dayOffScenes)}。${pickFrom(rng, ['家族時間を優先できた', '近所の空気を吸ってリセット', '買い物の荷物が重くてちょっと筋トレ気分', '昼寝で体力チャージできた'])}。`

  const workLearning = dayInfo.isWorkday
    ? pickFrom(rng, [
      '短くてもゴールを握って会議に入ると迷子にならないと再確認',
      'レビューは「一言でどこが良いか」から入ると雰囲気が柔らかい',
      '証券会社の人の質問パターンをメモしておくと返答が速い',
      'Notionに決定事項を即書きするだけで翌日の自分が助かる',
      '昼前に難しいタスクを当てると意外と進むと再発見'
    ])
    : pickFrom(rng, [
      '休みでもメモだけ先に用意しておくと月曜の自分が楽',
      '体を休めるのも仕事のうち、と言い聞かせて罪悪感を減らす',
      '家事の段取りを仕事のタスク分解と同じ要領でやると早い',
      '子どもの予定と自分の予定を同じカレンダーにまとめると迷わない'
    ])

  const money = `${pickFrom(rng, ['スーパーで特売を拾う', '子どもの参考書代が響く', '水道光熱費がじわっと上昇', 'ドラッグストアで生活用品をまとめ買い', 'ポイント消化のために日用品を購入', '外食を一回減らして自炊を増やす'])}。${pickFrom(rng, ['家計簿アプリにすぐ入力', 'ポイント還元日を狙って支払い', '小銭入れを軽くして気分も軽い', '買う物リストを事前に共有してブレを減らす'])}。`
  const moneyTip = pickFrom(rng, [
    'レシート撮影は帰宅後5分以内に済ませる',
    '現金払いは1日1回までと決めると無駄遣いが減る',
    '欲しい物は翌朝まで寝かせてから買う',
    '送料無料に釣られず総額を見る'
  ])

  const parenting = pickFrom(rng, [
    '聖太郎は模試の復習で机にかじりつき。夜に軽く声をかけて様子見',
    '蓮子は吹奏楽の新曲でテンション高め。バイトの愚痴も少し聞いた',
    '連次郎丸はRoblox三昧。30分だけ一緒にプレイして区切りを作った',
    '家族で夕飯のメニューを決める会議を開催。意外と盛り上がる',
    '兄弟で動画を観て爆笑。音量だけは要調整',
    'さっこが見つけたレシピで晩ご飯づくりを手伝った',
    '次男のゲーム時間を一緒にタイマーで区切った',
    'テスト前の聖太郎に夜食を差し入れ',
    '蓮子のバイト帰宅に合わせて風呂を温めておいた',
    '家族でゴミ出し当番をローテして負担分散'
  ])
  const dadpt = pickFrom(rng, [
    '短時間でも長男の勉強に付き添う',
    '笑わせ役を買って出て家の空気を柔らかくする',
    '連次郎丸のゲームタイムを一緒に区切る',
    '蓮子の話を遮らず最後まで聞く',
    'さっこの愚痴をまず受け止める',
    '寝る前に5分だけでも子どもと対話',
    '家事を1つ多めに引き受けておく',
    'スキンシップを意識して抱きしめる',
    'ありがとうを口に出す',
    '自分の疲れを正直に伝えて協力を求める'
  ])

  const hobby = pickFrom(rng, [
    'ガンダムUCエンゲージでデイリー消化。新機体の演出が渋い',
    'LINEマンガで無料分を読み進める。寝落ち寸前のルーティン',
    'ピッコマで溜めてた話を一気読み。広告の合間にストレッチ',
    'Spotifyで懐かしのアニソンを流しながら皿洗い',
    'YouTubeで懐かしのゲーム実況をBGMにする',
    '無料ガチャの結果に一喜一憂',
    'マンガの続巻が気になりつつ我慢',
    'お気に入りプレイリストを整理して通勤用に備える'
  ])

  const moodScore = Math.min(10, Math.max(3, (dayInfo.isWorkday ? 6 : 7) + Math.floor(rng() * 3)))
  const thanks = pickFrom(rng, [
    'さっこが温かいお茶を出してくれた',
    '子どもたちが皿洗いを手伝ってくれた',
    '近所の人が野菜をおすそ分けしてくれた',
    '好きな音楽で肩の力が抜けた',
    'バイト先の人が差し入れをくれた',
    '家族がゴミ出しを代わってくれた'
  ])

  const tomorrow = pickFrom(rng, [
    '朝のうちに洗濯を2回回してから集中タイムに入りたい',
    'タスクを3つに絞って確実に終わらせる',
    '子どもの送迎前に軽く散歩して頭をクリアにする',
    '夕方は早めに風呂を沸かしてのんびりする',
    '早寝して翌朝のパフォーマンスを上げる',
    '昼休みにストレッチを挟む',
    '夜はスマホを遠ざけて読書する'
  ])

  return { quip, work, workLearning, money, moneyTip, parenting, dadpt, hobby, mood: String(moodScore), thanks, tomorrow, trend }
}
