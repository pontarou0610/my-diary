param(
  [datetime]$Since = (Get-Date).AddDays(-7)
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$postsRoot = Join-Path $root 'content/posts'
if (-not (Test-Path $postsRoot)) { Write-Host "No posts yet."; exit 0 }

$files = Get-ChildItem -Path $postsRoot -Recurse -Filter *.md |
  Where-Object { $_.LastWriteTime -ge $Since } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 7

if (-not $files) { Write-Host "No posts found in last 7 days."; exit 0 }

$date = Get-Date
$weeklyDir = Join-Path $postsRoot (Join-Path ($date.ToString('yyyy/MM')) 'weekly')
New-Item -ItemType Directory -Force -Path $weeklyDir | Out-Null
$outfile = Join-Path $weeklyDir ("weekly-" + $date.ToString('yyyy-MM-dd') + ".md")

$frontMatter = @(
  '+++',
  "title = \"週間まとめ ($($date.ToString('yyyy-MM-dd')))\"",
  "date = $($date.ToString('yyyy-MM-ddTHH:mm:sszzz'))",
  'draft = true',
  'tags = ["まとめ"]',
  'categories = ["週間まとめ"]',
  '+++'
) -join "`n"

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('今週の振り返りリンク集。') | Out-Null
$lines.Add('') | Out-Null
foreach ($f in $files) {
  $content = Get-Content -Raw -Encoding UTF8 $f.FullName
  $title = ($content -split "`n" | Where-Object { $_ -match '^title\s*=\s*\"' } | Select-Object -First 1)
  if ($title) { $title = ($title -replace '^title\s*=\s*\"', '') -replace '\"$', '' } else { $title = $f.BaseName }
  $rel = ($f.FullName.Substring($root.Length)).TrimStart('\\','/').Replace('content','').Replace('\\','/').Replace('.md','/')
  if (-not $rel.StartsWith('/')) { $rel = '/' + $rel }
  $lines.Add("- [$title]($rel)") | Out-Null
}

$body = $lines -join "`n"
Set-Content -Encoding UTF8 -Path $outfile -Value ($frontMatter + "`n`n" + $body)
Write-Host "Created: $outfile" -ForegroundColor Green

