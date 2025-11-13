import { mkdir, writeFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function formatTokyoParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  const yyyy = parts.year
  const mm = parts.month
  const dd = parts.day
  return { yyyy, mm, dd }
}

function maskPrivacy(text) {
  if (!text) return text
  return text
    // emails
    .replace(/[\w.-]+@[\w.-]+/g, '***@***')
    // phone-like
    .replace(/\+?\d[\d\-\s]{8,}\d/g, '***-****-****')
}

async function fileExists(p) {
  try { await access(p, constants.F_OK); return true } catch { return false }
}

async function main() {
  const repoRoot = process.cwd()
  const { yyyy, mm, dd } = formatTokyoParts()
  const relDir = path.join('content', 'posts', yyyy, mm, dd)
  const absDir = path.join(repoRoot, relDir)
  await mkdir(absDir, { recursive: true })

  const slug = `${yyyy}-${mm}-${dd}`
  const absFile = path.join(absDir, `${slug}.md`)
  if (await fileExists(absFile)) {
    console.log(`Already exists: ${absFile}`)
    return
  }

  const draft = 'false' // Actionsで直公開

  const sys = `あなたは40代の会社員「ぽん次郎」。SES勤務で証券会社に常駐だがフルリモート。\n妻はさっこ（専業主婦）、子は長男:高3、長女:高1(吹奏楽部)、次男:小5(不登校気味)。\n本業だけでは生活が厳しいため、毎週土曜か日曜のどちらかで日雇いのオフィス移転作業のバイトをしている。\n長男は大学受験予定だが成績が足りず進路に不安がある。スーパーでアルバイト中。\n長女は「あんさんぶるスターズ」が好きで、ファミレスでアルバイト中。\n次男はRobloxに夢中。\n趣味: スマホゲーム「機動戦士ガンダムUCエンゲージ」にハマっている。\n文体: 徒然な随筆風。肩の力が抜けた口語で、所々に内省や小ネタを挟み、生活の具体物（天気・家事・音・匂い）を織り交ぜる。固有名詞や正確な地名はぼかす。旬なトレンド（ニュース/ネット話題/季節の行事）を軽く一言まぶす。\n分量: 日記全体の合計を2000〜2400字程度にする。\nHugoブログ用に、以下のJSON schemaで出力（各フィールドの目安文字数）:\n{"quip":"40-80字","work":"300-400字","work_learning":"60-100字","money":"300-400字","money_tip":"60-100字","parenting":"400-600字","dad_points":"20-60字","hobby":"300-400字","mood":"1-10","thanks":"60-120字","tomorrow":"80-140字"}\n句読点と改行は自然に。絵文字・顔文字は使わない。`

  // Decide weekend side-job plan with Saturday school event consideration
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', weekday: 'long' }).format(new Date())
  const rnd = Math.random()
  const schoolEventSat = Math.random() < 0.3
  let planned = 'None'
  if (day === 'Saturday') {
    planned = schoolEventSat ? 'Sunday' : (Math.random() < 0.5 ? 'Saturday' : 'Sunday')
  } else if (day === 'Sunday') {
    planned = schoolEventSat ? 'Sunday' : (Math.random() < 0.5 ? 'Saturday' : 'Sunday')
  }
  const isTodaySJ = (day === 'Saturday' && planned === 'Saturday') || (day === 'Sunday' && planned === 'Sunday')
  const schoolJP = schoolEventSat ? 'あり' : 'なし'
  const pdayJP = planned === 'Saturday' ? '土曜' : planned === 'Sunday' ? '日曜' : 'なし'
  const todaySJJP = isTodaySJ ? 'はい' : 'いいえ'

  const usr = `前提日付: ${yyyy}-${mm}-${dd} (JST)\n週末バイト計画: 土曜の学校行事=${schoolJP}, バイト予定日=${pdayJP}, 今日がその日=${todaySJJP}。\n状況: 平日/週末などを文脈化して軽く触れて。週末は日雇いバイト（オフィス移転作業）の有無や疲労感/収入の一言も自然に。\n露骨な実名/場所は出さない。出力は必ずJSONのみ。`

  let quip, work, workLearning, money, moneyTip, parenting, dadpt, hobby, mood, thanks, tomorrow
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
          { role: 'user', content: usr }
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
      const json = await resp.json()
      const content = json.choices?.[0]?.message?.content
      try {
        const data = JSON.parse(content)
        quip = data.quip
        work = data.work
        workLearning = data.work_learning
        money = data.money
        moneyTip = data.money_tip
        parenting = data.parenting
        dadpt = data.dad_points
        hobby = data.hobby
        mood = data.mood
        thanks = data.thanks
        tomorrow = data.tomorrow
      } catch {}
    } catch (e) {
      console.warn('OpenAI生成に失敗:', e.message)
    }
  } else {
    console.warn('OPENAI_API_KEY 未設定。テンプレ文を使用します。')
  }

  if (!quip) {
    const quips = [
      '靴下が左右で違っても、満員電車は気づかない。',
      '在宅だとコーヒーの消費量が指数関数。',
      '子の寝落ち=親の勝利。だが一緒に寝落ちがオチ。',
      '締切は敵じゃない、味方にすると強い。',
      '財布の現金、なぜか消える手品。'
    ]
    quip = quips[Math.floor(Math.random()*quips.length)]
    work = '在宅で会議多め。小さく決めて前へ。'
    workLearning = '期限と制約は味方。'
    money = '日用品や食費。買う日を決めて迷いを減らす。'
    moneyTip = 'ポイントデーにまとめ買い。'
    parenting = '年代感のある出来事や会話。小さな前進を拾う。'
    dadpt = '今日は+1（宿題見守り）'
    hobby = '銭湯/漫画/ランニング/ガジェットのどれかを一言レビュー。'
    mood = ''
    thanks = ''
    tomorrow = ''
  }

  // Try Pexels cover image
  let coverRel = null
  const pexKey = process.env.PEXELS_API_KEY
  if (pexKey) {
    try {
      const query = (hobby || '') + ' ' + (parenting || '') + ' ' + (work || '') || '東京 日常 家族 夕方'
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
    const alt = (quip || '').replaceAll('"','\"')
    fmLines.push('[cover]')
    fmLines.push(`  image = "${coverRel}"`)
    fmLines.push(`  alt = "${alt}"`)
    fmLines.push('  relative = true')
  }
  fmLines.push('+++')
  const frontMatter = fmLines.join('\n')

  const body = `今日のひとこと: ${maskPrivacy(quip)}\n\n` +
`## 仕事\n${maskPrivacy(work)}\n\n` +
`{{< learn >}}${maskPrivacy(workLearning)}{{< /learn >}}\n\n` +
`## お金\n${maskPrivacy(money)}\n\n` +
`{{< tip >}}${maskPrivacy(moneyTip)}{{< /tip >}}\n\n` +
`## 子育て\n${maskPrivacy(parenting)}\n\n` +
`{{< dadpt >}}${maskPrivacy(dadpt)}{{< /dadpt >}}\n\n` +
`## 趣味\n${maskPrivacy(hobby)}\n\n` +
`## 気分・感謝・明日の一手\n- 気分: ${maskPrivacy(mood)}/10\n- 感謝: ${maskPrivacy(thanks)}\n- 明日の一手: ${maskPrivacy(tomorrow)}\n`

  const content = `${frontMatter}\n\n${body}`
  await writeFile(absFile, content, 'utf8')
  console.log('Created:', path.relative(repoRoot, absFile))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
