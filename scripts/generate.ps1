<#*
  Ponjiro の日記を生成する PowerShell スクリプト
  ローカル実行向け（CI は scripts/generate.mjs を使用）

  Usage:
    pwsh scripts/generate.ps1 [-Date yyyy-MM-dd] [-Publish] [-UseAI] [-Model gpt-4o-mini]
*#>
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

function Protect-Privacy {
  param([string]$Text)
  if (-not $Text) { return $Text }
  $t = $Text
  $t = [regex]::Replace($t, '([\w\.-]+)@([\w\.-]+)', '***@***')
  $t = [regex]::Replace($t, '(\+?\d[\d\-\s]{8,}\d)', '***-****-****')
  return $t
}

function Format-ForMarkdown {
  param([string]$Text)
  if (-not $Text) { return '' }
  $paras = ($Text -split "`r?`n" | ForEach-Object { $_.Trim() }) | Where-Object { $_ }
  $out = @()
  foreach ($para in $paras) {
    $sentences = @()
    $buf = ''
    foreach ($ch in $para.ToCharArray()) {
      $buf += $ch
      if ('。．！？!?' -like "*$ch*") {
        $sentences += $buf.Trim()
        $buf = ''
      }
    }
    if ($buf.Trim().Length -gt 0) { $sentences += $buf.Trim() }
    if ($sentences.Count -eq 0) { $sentences += $para.Trim() }
    $out += ($sentences -join "`n")
  }
  return ($out -join "`n`n")
}

function Get-WeekdayJP {
  param([datetime]$D)
  $culture = [System.Globalization.CultureInfo]::GetCultureInfo('ja-JP')
  return $D.ToString('dddd', $culture)
}

function Get-TitleFromQuip {
  param([string]$DateString,[string]$Quip)
  $clean = (Protect-Privacy $Quip).Replace("`r",'').Replace("`n",' ').Trim()
  $clean = ($clean -replace '\s+',' ')
  if (-not $clean) { return "$DateString 日記" }
  $snippet = if ($clean.Length -gt 20) { $clean.Substring(0,20) + '…' } else { $clean }
  return "$DateString 日記 - $snippet"
}

function Get-SideJobPlan {
  param([datetime]$D)
  $rand = [System.Random]::new()
  $day = $D.DayOfWeek
  $schoolEventSat = $false
  $plannedDay = 'None'
  if ($day -eq [System.DayOfWeek]::Saturday -or $day -eq [System.DayOfWeek]::Sunday) {
    $schoolEventSat = ($rand.NextDouble() -lt 0.3)
    if ($schoolEventSat) { $plannedDay = 'Sunday' }
    else { $plannedDay = if ($rand.NextDouble() -lt 0.5) { 'Saturday' } else { 'Sunday' } }
  }
  $isToday = ($day -eq [System.DayOfWeek]::Saturday -and $plannedDay -eq 'Saturday') -or
             ($day -eq [System.DayOfWeek]::Sunday   -and $plannedDay -eq 'Sunday')
  [pscustomobject]@{
    SchoolEventOnSaturday = $schoolEventSat
    PlannedSideJobDay     = $plannedDay
    IsTodaySideJob        = $isToday
  }
}

function Get-PexelsQuery {
  param([string]$Hobby,[string]$Parenting,[string]$Work)
  $extraTags = @('昼','夜','夕方','朝','雨','晴れ','リビング','カフェ','公園','街','家族')
  $extra = Get-Random -InputObject $extraTags
  $base = ("$Hobby $Parenting $Work").Trim()
  $q = ("$base $extra").Trim()
  if (-not $q) { $q = '東京 日常 家庭' }
  return $q
}

# ===== パス設定 =====
$root = Split-Path -Parent $PSScriptRoot
$rel  = $Date.ToString('yyyy/MM/dd')
$dir  = Join-Path $root (Join-Path 'content/posts' $rel)
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$slug = $Date.ToString('yyyy-MM-dd')
$path = Join-Path $dir ("$slug.md")
if (Test-Path $path) { Write-Host "Already exists: $path" -ForegroundColor Yellow; exit 0 }
$draft = if ($Publish) { 'false' } else { 'true' }

# プロンプト
$plan = Get-SideJobPlan -D $Date
$schoolJP = if ($plan.SchoolEventOnSaturday) { 'あり' } else { 'なし' }
$pdayJP   = if ($plan.PlannedSideJobDay -eq 'Saturday') { '土曜' } elseif ($plan.PlannedSideJobDay -eq 'Sunday') { '日曜' } else { 'なし' }
$todaySJ  = if ($plan.IsTodaySideJob) { 'はい' } else { 'いいえ' }
$weekdayJP = Get-WeekdayJP -D $Date

$sys = @"
あなたは40代の会社員「ぽん次郎」。SES勤務で証券会社に常駐だがフルリモート。妻はさっこ（専業主婦寄り）。家計管理はぽん次郎が手動で、さっこは家計簿をつけず、ファッションなど好きなものにお金を使いがちな浪費家。子どもは3人。長男:聖太郎（高3・大学受験予定だが成績が足りず不安。スーパーでアルバイト中）、長女:蓮子（高1・吹奏楽部。あんさんぶるスターズが好きでファミレスでバイト中）、次男:連次郎丸（小3・不登校気味でRobloxに夢中）。趣味はスマホゲーム「機動戦士ガンダムUCエンゲージ」と、LINEマンガ/ピッコマの無料話を寝る前に読む程度。本業だけでは生活が厳しいため、毎週土曜か日曜のどちらかで日雇いのオフィス移転作業のバイトをしている。肩の力が抜けた口語で、所々に小ネタを挟み、生活の具体物（天気・家事・音・匂い）を織り交ぜる。固有名詞や正確な地名はぼかす。旬なトレンド（ニュース/ネット話題/季節の行事）を軽く一言まぶす。
スタイル: 野原ひろし風の一人称「オレ」。庶民的でユーモラス、家族への愛情と弱音がちらつくが、最終的には前向きに落とす。
今日の日付: $($Date.ToString('yyyy-MM-dd'))（$weekdayJP）。日付・曜日・「明日」「週末」「来週」などの表現が矛盾しないよう整合を取る。
SEO を意識して、冒頭や各セクションの前半にその日のテーマ・キーワード（天気/体調/日雇い/子育て/趣味/お金）が自然に入るように書く。見出し直下で要点を一言入れて検索で拾われやすくする。
毎日同じ雰囲気にならないよう、日替わりで焦点を変える（例: 仕事の日は学び深掘り、家族の日は会話描写多め、趣味の日はレビューっぽく、金曜日は週末準備など）か、切り出し方を変えて一言めを変化させる。
文章は句点（。や！や？）で適度に改行し、読みやすさを優先する。
分量: 日記全体をおおよそ 2000〜2400 文字程度にする。
Hugoブログ用に、以下のJSON schemaで出力する（各フィールドは目安で調整可）。
{
  "quip": "今日のひとこと。天気や体調、日雇い予定（学校行事: $schoolJP, 日雇い予定日: $pdayJP, 今日が日雇い当日: $todaySJ）を絡める",
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

"@




$user = '上記JSON schemaどおりに、JSON文字列だけで返してください。'

$quip=$work=$workLearning=$money=$moneyTip=$parenting=$dadpt=$hobby=$mood=$thanks=$tomorrow=$null

if ($UseAI) {
  $dotenv = Get-DotEnv (Join-Path $root '.env')
  if (-not $env:OPENAI_API_KEY -and $dotenv['OPENAI_API_KEY']) { $env:OPENAI_API_KEY = $dotenv['OPENAI_API_KEY'] }
  if (-not $Model) { $Model = $env:OPENAI_MODEL; if (-not $Model) { $Model = 'gpt-4o-mini' } }
  if ($env:OPENAI_API_KEY) {
    try {
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
    '靴下が左右で違っても、満員電車なら誰も気づかない。',
    '在宅とコーヒーの消費量は比例する気がする。',
    '子の寝落ち=親の勝利。ただし親も一緒に寝落ちがオチ。',
    '締切は敵じゃない。味方につけると強い。',
    '財布の現金、なぜか消える手品。'
  )
  $quip = Get-Random -InputObject $quips
}

$coverRelative = $null
if ($env:PEXELS_API_KEY) {
  try {
    $q = Get-PexelsQuery -Hobby $hobby -Parenting $parenting -Work $work
    $page = Get-Random -Minimum 1 -Maximum 6
    $perPage = 15
    Add-Type -AssemblyName System.Web
    $uri = 'https://api.pexels.com/v1/search?per_page={0}&page={1}&orientation=landscape&query={2}' -f `
           $perPage, $page, [System.Web.HttpUtility]::UrlEncode($q)
    $headers = @{ Authorization = $env:PEXELS_API_KEY }
    $pex = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 30
    $photo = $pex.photos | Get-Random -Count 1
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
    Write-Warning ("Pexels画像取得に失敗: " + $_.Exception.Message)
  }
}

$title = Get-TitleFromQuip -DateString $Date.ToString('yyyy-MM-dd') -Quip $quip

$fmLines = @(
  '+++',
  "title = `"$title`"",
  "date = $($Date.ToString('yyyy-MM-ddTHH:mm:sszzz'))",
  "draft = $draft",
  'tags = ["日記", "仕事", "お金", "子育て", "趣味"]',
  'categories = ["日常"]'
)
if ($coverRelative) {
  $alt = if ($null -ne $quip -and $quip -ne '') { $quip -replace '"','\"' } else { '' }
  $fmLines += '[cover]'
  $fmLines += "  image = `"$coverRelative`""
  $fmLines += "  alt = `"$alt`""
  $fmLines += '  relative = true'
}
$fmLines += '+++'
$frontMatter = $fmLines -join "`n"

$body = @"
今日のひとこと: $(Format-ForMarkdown (Protect-Privacy $quip))

## 仕事
$(Format-ForMarkdown (Protect-Privacy $work))

{{< learn >}}
$(Format-ForMarkdown (Protect-Privacy $workLearning))
{{< /learn >}}

## お金
$(Format-ForMarkdown (Protect-Privacy $money))

{{< tip >}}
$(Format-ForMarkdown (Protect-Privacy $moneyTip))
{{< /tip >}}

## 子育て
$(Format-ForMarkdown (Protect-Privacy $parenting))

{{< dadpt >}}
$(Format-ForMarkdown (Protect-Privacy $dadpt))
{{< /dadpt >}}

## 趣味
$(Format-ForMarkdown (Protect-Privacy $hobby))

## 気分・感謝・明日の一手
- 気分: $(Protect-Privacy $mood)/10
- 感謝: $(Protect-Privacy $thanks)
- 明日の一手: $(Protect-Privacy $tomorrow)
"@

$content = $frontMatter + "`n`n" + $body
Set-Content -Encoding UTF8 -Path $path -Value $content
Write-Host "Created: $path" -ForegroundColor Green
