/**
 * GitHub Actions 用: Ponjiro の日記を AI / Pexels 付きで生成するスクリプト。
 * node scripts/generate.mjs
 */
import { mkdir, writeFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * formatTokyoParts
 * JSTの年月日を2桁で返し、/content/posts/YYYY/MM/DD/ のディレクトリを決める。
 * @param {Date} date
 * @returns {{yyyy:string, mm:string, dd:string}}
 */
function formatTokyoParts(date = new Date()) {
  // 投稿ディレクトリ作成用に JST ベースの日付パーツを返す（/content/posts/YYYY/MM/DD）
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  const yyyy = parts.year
  const mm = parts.month
  const dd = parts.day
  return { yyyy, mm, dd }
}

/**
 * maskPrivacy
 * メールアドレスや電話番号っぽい文字列を伏せ字にする。
 * @param {string|number|null|undefined} text
 * @returns {string}
 */
function maskPrivacy(text) {
  // 生成文中のメール・電話らしき文字列をぼかす
  // （CI上で投稿前に最低限のプライバシーケア）
  if (text === null || text === undefined) return ''
  const s = String(text)
  return s
    .replace(/[\w.-]+@[\w.-]+/g, '***@***')
    .replace(/\+?\d[\d\-\s]{8,}\d/g, '***-****-****')
}

/**
 * fileExists
 * 非同期でファイルの存在を確認
 * @param {string} p
 * @returns {Promise<boolean>}
 */
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true } catch { return false }
}

/**
 * decideSideJobPlan
 * 週末の日雇いバイトの予定日（学校行事の揺らぎ込み）を決める。
 * @param {Date} tzNow
 * @returns {{schoolJP:string, pdayJP:string, todaySJJP:string}}
 */
function decideSideJobPlan(tzNow = new Date()) {
  // 土日のどちらで日雇いをするか（学校行事の揺らぎ含む）を毎回決定
  // GitHub Actions 側では毎回実行時刻が異なるので、当日の pending 作業を決める
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'long' })
  const day = fmt.format(tzNow) // 'Saturday' / 'Sunday' / ...
  const schoolEventSat = Math.random() < 0.3
  let planned = 'None'
  if (day === 'Saturday' || day === 'Sunday') {
    if (schoolEventSat) {
      planned = 'Sunday'
    } else {
      planned = Math.random() < 0.5 ? 'Saturday' : 'Sunday'
    }
  }
  const isTodaySJ = (day === 'Saturday' && planned === 'Saturday') || (day === 'Sunday' && planned === 'Sunday')
  const schoolJP = schoolEventSat ? 'あり' : 'なし'
  const pdayJP = planned === 'Saturday' ? '土曜' : planned === 'Sunday' ? '日曜' : 'なし'
  const todaySJJP = isTodaySJ ? 'はい' : 'いいえ'
  return { schoolJP, pdayJP, todaySJJP }
}

/**
 * main
 * GitHub Actions 上で 1 日分の markdown + cover.jpg を生成するメイン処理
 */
async function main() {
  const repoRoot = process.cwd()
  const { yyyy, mm, dd } = formatTokyoParts()
  const relDir = path.join('content', 'posts', yyyy, mm, dd)
  const absDir = path.join(repoRoot, relDir)
  await mkdir(absDir, { recursive: true })

  const slug = `${yyyy}-${mm}-${dd}`
  const absFile = path.join(absDir, `${slug}.md`)
  if (await fileExists(absFile)) {
    // 同じ日付が存在するなら何もしない（重複生成防止）
    console.log(`Already exists: ${absFile}`)
    return
  }

  const draft = 'false' // CIでは即公開

  const { schoolJP, pdayJP, todaySJJP } = decideSideJobPlan()

  const sys =
`あなたは40代の会社員「ぽん次郎」。SES勤務で証券会社に常駐だがフルリモート。
妻はさっこ（専業主婦）。家計管理はぽん次郎が担当で、さっこは家計簿はつけず、ファッションや自分の好きなものにお金を使いがちな浪費家。
子どもは、長男:聖太郎（高3・大学受験予定だが成績が足りず不安。スーパーでアルバイト中）、長女:蓮子（高1・吹奏楽部。あんさんぶるスターズが好きでファミレスでバイト中）、次男:連次郎丸（小5・不登校気味でRobloxに夢中）。
趣味はスマホゲーム「機動戦士ガンダムUCエンゲージ」と、LINEマンガやピッコマの無料話を寝る前に読む程度。
本業だけでは生活が厳しいため、毎週土曜か日曜のどちらかで日雇いのオフィス移転作業のバイトをしている。
文体: 徒然な随筆風。肩の力が抜けた口語で、所々に内省や小ネタを挟み、生活の具体物（天気・家事・音・匂い）を織り交ぜる。固有名詞や正確な地名はぼかす。旬なトレンド（ニュース/ネット話題/季節の行事）を軽く一言まぶす。
. スタイル: 野原ひろし風の一人称「オレ」。庶民的でユーモラス、家族への愛情と弱音がちらつくが、最終的には前向きに落とす。
分量: 日記全体の合計を2000〜2400字程度にする。
Hugoブログ用に、以下のJSON schemaで出力する（各フィールドの目安は適宜調整してOK）
{
  "quip": "今日のひとこと。50〜80字。天気や体調、日雇い予定（学校行事の有無: ${schoolJP}, 日雇い予定日: ${pdayJP}, 今日が日雇い当日か: ${todaySJJP}）を絡める。",
  "work": "仕事。350〜450字。リモート勤務、会議、雑務、仕事仲間とのやりとりなど。",
  "work_learning": "仕事からの学び。150〜250字。",
  "money": "お金。350〜450字。家計、教育費、日用品、節約、買い物、バイト代の使い道など。",
  "money_tip": "お金に関する気づき・ミニTips。100〜200字。",
  "parenting": "子育て。350〜450字。長男・長女・次男の様子や悩み、夫婦のやりとりを含めて。",
  "dad_points": "父親として意識したいこと。100〜200字。",
  "hobby": "趣味。300〜400字。ガンダムUCエンゲージ、漫画（LINEマンガ/ピッコマ）、音楽など。",
  "mood": "気分を 0〜10 で数値。整数。",
  "thanks": "感謝。100〜200字。",
  "tomorrow": "明日の一手。100〜200字。"
}
JSON だけを出力する。`

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
    // ===== OpenAI で生成 =====
    try {
      const body = {
        model,
        messages: [
          { role: 'system', content: sys },
          {
            role: 'user',
            content: '上記 JSON schema どおりに JSON だけ返してください。'
          }
        ],
        response_format: { type: 'json_object' }
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
      const json = await resp.json()
      const content = json.choices?.[0]?.message?.content
      try {
        const data = JSON.parse(content)
        quip         = data.quip
        work         = data.work
        workLearning = data.work_learning
        money        = data.money
        moneyTip     = data.money_tip
        parenting    = data.parenting
        dadpt        = data.dad_points
        hobby        = data.hobby
        mood         = data.mood
        thanks       = data.thanks
        tomorrow     = data.tomorrow
      } catch {
        console.warn('JSON parse failed for OpenAI content')
      }
    } catch (e) {
      console.warn('OpenAI生成に失敗:', e.message)
    }
  } else {
    console.warn('OPENAI_API_KEY 未設定。テンプレ文を使用します。')
  }

  if (!quip) {
    // AI 生成が失敗した場合のフォールバック
    const quips = [
      '靴下が左右で違っても、満員電車は気づかない。',
      '在宅だとコーヒーの消費量が指数関数。',
      '子の寝落ち=親の勝利。ただし親も一緒に寝落ちがオチ。',
      '締切は敵じゃない、味方にすると強い。',
      '財布の現金、なぜか消える手品。'
    ]
    quip = quips[Math.floor(Math.random() * quips.length)]
    work = '在宅で会議多め。小さく決めて前へ。'
    workLearning = '期限と制約は味方。'
    money = '日用品や食費。買う日を決めて迷いを減らす。'
    moneyTip = 'ポイントデーにまとめ買い。'
    parenting = '年代感のある出来事や会話。小さな前進を拾う。'
    dadpt = '今日は+1（宿題見守り）'
    hobby = 'スマホゲームか、LINEマンガやピッコマの無料話を読むくらい。'
    mood = ''
    thanks = ''
    tomorrow = ''
  }

  // ==== Pexels cover image ====
  let coverRel = null
  const pexKey = process.env.PEXELS_API_KEY
  if (pexKey) {
    try {
      const query =
        (hobby || '') + ' ' +
        (parenting || '') + ' ' +
        (work || '') ||
        '東京 日常 家族 夕方'
      const url = `https://api.pexels.com/v1/search?per_page=1&orientation=landscape&query=${encodeURIComponent(query)}`
      const resp = await fetch(url, { headers: { Authorization: pexKey } })
      if (resp.ok) {
        const data = await resp.json()
        const photo = data.photos?.[0]
        const src = photo?.src?.large2x || photo?.src?.large || photo?.src?.landscape
        if (src) {
          const imgResp = await fetch(src, { headers: { Authorization: pexKey } })
          if (imgResp.ok) {
            const buf = Buffer.from(await imgResp.arrayBuffer())
            coverRel = 'cover.jpg'
            await writeFile(path.join(absDir, coverRel), buf)
          }
        }
      }
    } catch (e) {
      console.warn('Pexels取得に失敗:', e.message)
    }
  }

  const fmLines = [
    '+++',
    `title = "${yyyy}-${mm}-${dd} 日記"`,
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
    fmLines.push('  relative = true')
  }
  fmLines.push('+++')
  const frontMatter = fmLines.join('\n')

  // 最終的な Markdown を構築（読みやすいように段落間に空行を入れる）
  const body =
`今日のひとこと: ${maskPrivacy(quip)}

## 仕事

${maskPrivacy(work)}

{{< learn >}}${maskPrivacy(workLearning)}{{< /learn >}}

## お金

${maskPrivacy(money)}

{{< tip >}}${maskPrivacy(moneyTip)}{{< /tip >}}

## 子育て

${maskPrivacy(parenting)}

{{< dadpt >}}${maskPrivacy(dadpt)}{{< /dadpt >}}

## 趣味

${maskPrivacy(hobby)}

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
