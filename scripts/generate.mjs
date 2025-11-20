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
function decideSideJobPlan(tzNow = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'long' })
  const day = fmt.format(tzNow)
  const schoolEventSat = Math.random() < 0.3
  let planned = 'None'
  if (day === 'Saturday' || day === 'Sunday') {
    planned = schoolEventSat ? 'Sunday' : (Math.random() < 0.5 ? 'Saturday' : 'Sunday')
  }
  const isTodaySJ = (day === 'Saturday' && planned === 'Saturday') || (day === 'Sunday' && planned === 'Sunday')
  const schoolJP = schoolEventSat ? 'あり' : 'なし'
  const pdayJP = planned === 'Saturday' ? '土曜' : planned === 'Sunday' ? '日曜' : 'なし'
  const todaySJJP = isTodaySJ ? 'はい' : 'いいえ'
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

function buildPexelsQuery(hobby, parenting, work) {
  const extraTags = ['昼', '夜', '夕方', '朝', '雨', '晴れ', 'リビング', 'カフェ', '公園', '街', '家族']
  const extra = extraTags[Math.floor(Math.random() * extraTags.length)]
  const base = `${hobby || ''} ${parenting || ''} ${work || ''}`.trim()
  const query = `${base} ${extra}`.trim()
  return query || '東京 日常 家庭'
}

async function main() {
  const repoRoot = process.cwd()
  const { yyyy, mm, dd } = formatTokyoParts()
  const weekdayJP = formatTokyoWeekdayJP()
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
  const { schoolJP, pdayJP, todaySJJP } = decideSideJobPlan()

  const sys = `
あなたは40代の会社員「ぽん次郎」。SES勤務で証券会社に常駐だがフルリモート。妻はさっこ（専業主婦寄り）。家計管理はぽん次郎が手動で、さっこは家計簿をつけず、ファッションなど好きなものにお金を使いがちな浪費家。子どもは3人。長男:聖太郎（高3・大学受験予定だが成績が足りず不安。スーパーでアルバイト中）、長女:蓮子（高1・吹奏楽部。あんさんぶるスターズが好きでファミレスでバイト中）、次男:連次郎丸（小3・不登校気味でRobloxに夢中）。趣味はスマホゲーム「機動戦士ガンダムUCエンゲージ」と、LINEマンガ/ピッコマの無料話を寝る前に読む程度。本業だけでは生活が厳しいため、毎週土曜か日曜のどちらかで日雇いのオフィス移転作業のバイトをしている。肩の力が抜けた口語で、所々に小ネタを挟み、生活の具体物（天気・家事・音・匂い）を織り交ぜる。固有名詞や正確な地名はぼかす。旬なトレンド（ニュース/ネット話題/季節の行事）を軽く一言まぶす。
スタイル: 野原ひろし風の一人称「オレ」。庶民的でユーモラス、家族への愛情と弱音がちらつくが、最終的には前向きに落とす。
今日の日付: ${yyyy}-${mm}-${dd}（${weekdayJP}）。日付・曜日・「明日」「週末」「来週」などの表現が矛盾しないよう整合を取る。
分量: 日記全体をおおよそ 2000〜2400 文字程度にする。
Hugoブログ用に、以下のJSON schemaで出力する（各フィールドは目安で調整可）。
{
  "quip": "今日のひとこと。天気や体調、日雇い予定（学校行事: ${schoolJP}, 日雇い予定日: ${pdayJP}, 今日が日雇い当日: ${todaySJJP}）を絡める",
  "work": "仕事。リモート勤務、会議、雑務、仕事仲間とのやりとりなど",
  "work_learning": "仕事からの学び",
  "money": "お金。家計、教育費、日用品、節約や買い物、バイト代の使い道など",
  "money_tip": "お金に関する気づき・ミニTips",
  "parenting": "子育て。長男・長女・次男の様子や悩み、夫婦のやりとりも含めて",
  "dad_points": "父親として意識したいこと",
  "hobby": "趣味。ガンダムUCエンゲージ、漫画（LINEマンガ/ピッコマ）、音楽など",
  "mood": "気分。0〜10で数値。整数",
  "thanks": "感謝",
  "tomorrow": "明日の一手"
}
JSON だけを出力する。文章トーンは野原ひろし風の口調で、家族への愛情をさりげなくにじませて。
`;
  const userPrompt = '上記JSON schemaどおりに、JSON文字列だけで返してください。'

  let quip = ''
  let work = ''
  let workLearning = ''
  let money = ''
  let moneyTip = ''
  let parenting = ''
  let dadpt = ''
  let hobby = ''
  let mood = ''
  let thanks = ''
  let tomorrow = ''

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  if (apiKey) {
    try {
      const body = {
        model,
        temperature: 0.7,
        max_tokens: 1400,
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
        quip         = parsed.quip
        work         = parsed.work
        workLearning = parsed.work_learning
        money        = parsed.money
        moneyTip     = parsed.money_tip
        parenting    = parsed.parenting
        dadpt        = parsed.dad_points
        hobby        = parsed.hobby
        mood         = parsed.mood
        thanks       = parsed.thanks
        tomorrow     = parsed.tomorrow
      } catch {
        console.warn('JSON parse failed for OpenAI content')
      }
    } catch (e) {
      console.warn('OpenAI生成に失敗', e.message)
    }
  } else {
    console.warn('OPENAI_API_KEY 未設定。テンプレ文を使用します。')
  }

  if (!quip) {
    const quips = [
      '靴下が左右で違っても、満員電車なら誰も気づかない。',
      '在宅とコーヒーの消費量は比例する気がする。',
      '子の寝落ち=親の勝利。ただし親も一緒に寝落ちがオチ。',
      '締切は敵じゃない。味方につけると強い。',
      '財布の現金、なぜか消える手品。'
    ]
    quip = quips[Math.floor(Math.random() * quips.length)]
    work = '在宅会議多め。小さく決めて前へ。'
    workLearning = '期限と制約は味方。'
    money = '日用品や食費。買う物を決めて迷いを減らす。'
    moneyTip = 'ポイントデーにまとめ買い。'
    parenting = '年代感のある出来事や会話。小さな前進を拾う。'
    dadpt = '今日は+1（宿題見守り）。'
    hobby = 'スマホゲームか、LINEマンガ/ピッコマの無料話を読むくらい。'
    mood = ''
    thanks = ''
    tomorrow = ''
  }

  // ==== Pexels cover image ====
  let coverRel = null
  const pexKey = process.env.PEXELS_API_KEY
  if (pexKey) {
    try {
      const query = buildPexelsQuery(hobby, parenting, work)
      const page = Math.floor(Math.random() * 5) + 1 // 1〜5ページのいずれか
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
      console.warn('Pexels取得に失敗', e.message)
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

## 気分・感謝・明日の一手
- 気分: ${maskPrivacy(mood)}/10
- 感謝: ${maskPrivacy(thanks)}
- 明日の一手: ${maskPrivacy(tomorrow)}
`

  const content = `${frontMatter}\n\n${body}`
  await writeFile(absFile, content, 'utf8')
  console.log('Created:', path.relative(repoRoot, absFile))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
