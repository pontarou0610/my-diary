param(
  [datetime]$Date = (Get-Date),
  [switch]$Publish,
  [switch]$UseAI,
  [string]$Model = $env:OPENAI_MODEL
)

$ErrorActionPreference = 'Stop'

function Get-DotEnv {
  param([string]$FilePath)
  if (-not (Test-Path $FilePath)) { return @{} }
  $map = @{}
  Get-Content -Path $FilePath -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^\s*(#|$)') { return }
    $i = $_.IndexOf('=')
    if ($i -lt 1) { return }
    $k = $_.Substring(0,$i).Trim()
    $v = $_.Substring($i+1).Trim().Trim('"')
    $map[$k] = $v
  }
  return $map
}

function Mask-Privacy {
  param([string]$Text)
  if (-not $Text) { return $Text }
  $t = $Text
  $t = [regex]::Replace($t, '([\w\.-]+)@([\w\.-]+)', '***@***')
  $t = [regex]::Replace($t, '(\+?\d[\d\-\s]{8,}\d)', '***-****-****')
  return $t
}

function Get-SideJobPlan {
  param([datetime]$D)
  $rand = [System.Random]::new()
  $day = $D.DayOfWeek
  $schoolEventSat = $false
  $plannedDay = 'None'

  if ($day -eq [System.DayOfWeek]::Saturday -or $day -eq [System.DayOfWeek]::Sunday) {
    # 30%で「今週の土曜に学校行事あり」と仮定
    $schoolEventSat = ($rand.NextDouble() -lt 0.3)
    if ($schoolEventSat) {
      $plannedDay = 'Sunday'
    } else {
      $plannedDay = if ($rand.NextDouble() -lt 0.5) { 'Saturday' } else { 'Sunday' }
    }
  }

  $isToday = ($day -eq [System.DayOfWeek]::Saturday -and $plannedDay -eq 'Saturday') -or
             ($day -eq [System.DayOfWeek]::Sunday   -and $plannedDay -eq 'Sunday')

  [pscustomobject]@{
    SchoolEventOnSaturday = $schoolEventSat
    PlannedSideJobDay     = $plannedDay
    IsTodaySideJob        = $isToday
  }
}

$root = Split-Path -Parent $PSScriptRoot
$rel  = $Date.ToString('yyyy/MM/dd')
$dir  = Join-Path $root (Join-Path 'content/posts' $rel)
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$slug = $Date.ToString('yyyy-MM-dd')
$path = Join-Path $dir ("$slug.md")

if (Test-Path $path) {
  Write-Host "Already exists: $path" -ForegroundColor Yellow
  exit 0
}

$draft = if ($Publish) { 'false' } else { 'true' }

# デフォルト値（AI未使用時やエラー時に使用）
$quip         = $null
$work         = '在宅で会議多め。小さく決めて前へ。'
$workLearning = '期限と制約は味方。'
$money        = '日用品や食費。買う日を決めて迷いを減らす。'
$moneyTip     = 'ポイントデーにまとめ買い。'
$parenting    = '年代感のある出来事や会話。小さな前進を拾う。'
$dadpt        = '今日は+1（宿題見守り）'
$hobby        = 'スマホゲームか、LINEマンガやピッコマの無料話を読むくらい。'
$mood         = ''
$thanks       = ''
$tomorrow     = ''

if ($UseAI) {
  $dotenv = Get-DotEnv (Join-Path $root '.env')
  if (-not $env:OPENAI_API_KEY -and $dotenv['OPENAI_API_KEY']) {
    $env:OPENAI_API_KEY = $dotenv['OPENAI_API_KEY']
  }
  if (-not $Model) {
    $Model = $env:OPENAI_MODEL
    if (-not $Model) { $Model = 'gpt-4o-mini' }
  }

  if ($env:OPENAI_API_KEY) {
    try {
      $sys = @"
あなたは40代の会社員「ぽん次郎」。SES勤務で証券会社に常駐だがフルリモート。
妻はさっこ（専業主婦）。家計管理はぽん次郎が担当で、さっこは家計簿はつけず、ファッションや自分の好きなものにお金を使いがちな浪費家。
子どもは、長男:高3（大学受験予定だが成績が足りず不安。スーパーでアルバイト中）、長女:高1（吹奏楽部。あんさんぶるスターズが好きでファミレスでバイト中）、次男:小5（不登校気味でRobloxに夢中）。
趣味はスマホゲーム「機動戦士ガンダムUCエンゲージ」と、LINEマンガやピッコマの無料話を寝る前に読む程度。
本業だけでは生活が厳しいため、毎週土曜か日曜のどちらかで日雇いのオフィス移転作業のバイトをしている。
文体: 徒然な随筆風。肩の力が抜けた口語で、所々に内省や小ネタを挟み、生活の具体物（天気・家事・音・匂い）を織り交ぜる。固有名詞や正確な地名はぼかす。旬なトレンド（ニュース/ネット話題/季節の行事）を軽く一言まぶす。
分量: 日記全体の合計を2000〜2400字程度にする。
Hugoブログ用に、以下のJSON schemaで出力する（各フィールドの目安文字数も守る）:
{"quip":"40-80字","work":"300-400字","work_learning":"60-100字","money":"300-400字","money_tip":"60-100字","parenting":"400-600字","dad_points":"20-60字","hobby":"300-400字","mood":"1-10","thanks":"60-120字","tomorrow":"80-140字"}
句読点と改行は自然に。絵文字・顔文字は使わない。
"@

      $plan = Get-SideJobPlan -D $Date
      $school = if ($plan.SchoolEventOnSaturday) { 'あり' } else { 'なし' }
      $pday = switch ($plan.PlannedSideJobDay) {
        'Saturday' { '土曜' }
        'Sunday'   { '日曜' }
        default    { 'なし' }
      }
      $todaySJ = if ($plan.IsTodaySideJob) { 'はい' } else { 'いいえ' }

      $user = @"
前提日付: $($Date.ToString('yyyy-MM-dd (ddd)'))
週末バイト計画: 土曜の学校行事=$school, バイト予定日=$pday, 今日がその日=$todaySJ。
状況: 平日/週末などを文脈化して軽く触れて。週末は日雇いバイト（オフィス移転作業）の有無や疲労感/収入の一言も自然に。
露骨な実名/場所は出さない。出力は必ずJSONのみ。
"@

      $bodyObj = [pscustomobject]@{
        model           = $Model
        temperature     = 0.7
        max_tokens      = 1400
        response_format = @{ type = 'json_object' }
        messages        = @(
          @{ role = 'system'; content = $sys },
          @{ role = 'user'  ; content = $user }
        )
      }

      $bodyJson = $bodyObj | ConvertTo-Json -Depth 6

      $resp = Invoke-RestMethod -Method Post -Uri 'https://api.openai.com/v1/chat/completions' `
        -Headers @{ Authorization = "Bearer $($env:OPENAI_API_KEY)"; 'Content-Type' = 'application/json' } `
        -Body $bodyJson -TimeoutSec 60

      $txt  = $resp.choices[0].message.content
      $json = $null
      try { $json = $txt | ConvertFrom-Json -ErrorAction Stop } catch {}

      if ($json) {
        $quip         = $json.quip
        $work         = $json.work
        $workLearning = $json.work_learning
        $money        = $json.money
        $moneyTip     = $json.money_tip
        $parenting    = $json.parenting
        $dadpt        = $json.dad_points
        $hobby        = $json.hobby
        $mood         = $json.mood
        $thanks       = $json.thanks
        $tomorrow     = $json.tomorrow
      }
    } catch {
      Write-Warning ("OpenAI生成に失敗: " + $_.Exception.Message)
    }
  } else {
    Write-Warning 'OPENAI_API_KEY が未設定のため、テンプレ文で生成します。'
  }
}

if (-not $quip) {
  $quips = @(
    '靴下が左右で違っても、満員電車は気づかない。',
    '在宅だとコーヒーの消費量が指数関数。',
    '子の寝落ち=親の勝利。ただし親も一緒に寝落ちがオチ。',
    '締切は敵じゃない、味方にすると強い。',
    '財布の現金、なぜか消える手品。'
  )
  $quip = Get-Random -InputObject $quips
}

# Pexels からカバー画像取得（任意）
$coverRelative = $null
if ($env:PEXELS_API_KEY) {
  try {
    $q = ($hobby + ' ' + $parenting + ' ' + $work)
    if (-not $q -or $q.Trim().Length -lt 2) {
      $q = '東京 日常 家族 夕方'
    }
    Add-Type -AssemblyName System.Web
    $uri = 'https://api.pexels.com/v1/search?per_page=1&orientation=landscape&query=' + `
           [System.Web.HttpUtility]::UrlEncode($q)
    $headers = @{ Authorization = $env:PEXELS_API_KEY }
    $pex = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 30
    $photo = $pex.photos | Select-Object -First 1
    if ($photo -and $photo.src) {
      $imgUrl = $photo.src.large2x
      if (-not $imgUrl) { $imgUrl = $photo.src.large }
      if (-not $imgUrl) { $imgUrl = $photo.src.landscape }
      if ($imgUrl) {
        $imgPath = Join-Path $dir 'cover.jpg'
        Invoke-WebRequest -Uri $imgUrl -Headers $headers -OutFile $imgPath -TimeoutSec 60
        if (Test-Path $imgPath) { $coverRelative = 'cover.jpg' }
      }
    }
  } catch {
    Write-Warning ("Pexels画像取得失敗: " + $_.Exception.Message)
  }
}

$fmLines = @(
  '+++',
  "title = `"$($Date.ToString('yyyy-MM-dd')) 日記`"",
  "date = $($Date.ToString('yyyy-MM-ddTHH:mm:sszzz'))",
  "draft = $draft",
  'tags = ["日記", "仕事", "お金", "子育て", "趣味"]',
  'categories = ["日常"]'
)
if ($coverRelative) {
  $alt = ($quip ?? '') -replace '"','\"'
  $fmLines += '[cover]'
  $fmLines += "  image = `"$coverRelative`""
  $fmLines += "  alt = `"$alt`""
  $fmLines += '  relative = true'
}
$fmLines += '+++'
$frontMatter = $fmLines -join "`n"

$body = @"
今日のひとこと: $(Mask-Privacy $quip)

## 仕事
$(Mask-Privacy $work)

{{< learn >}}$(Mask-Privacy $workLearning){{< /learn >}}

## お金
$(Mask-Privacy $money)

{{< tip >}}$(Mask-Privacy $moneyTip){{< /tip >}}

## 子育て
$(Mask-Privacy $parenting)

{{< dadpt >}}$(Mask-Privacy $dadpt){{< /dadpt >}}

## 趣味
$(Mask-Privacy $hobby)

## 気分・感謝・明日の一手
- 気分: $(Mask-Privacy $mood)/10
- 感謝: $(Mask-Privacy $thanks)
- 明日の一手: $(Mask-Privacy $tomorrow)
"@

$content = $frontMatter + "`n`n" + $body
Set-Content -Encoding UTF8 -Path $path -Value $content
Write-Host "Created: $path" -ForegroundColor Green

