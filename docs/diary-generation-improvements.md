# 日記生成スクリプトの運用メモ

`scripts/generate.mjs` で日記記事を自動生成します。OpenAI / Pexels は環境変数が設定されている場合のみ使用します。

## 生成される記事
- 日次: `content/posts/YYYY/MM/DD/YYYY-MM-DD.md`
- 週次（東京・日曜夜）: `content/posts/YYYY/weekly/week-YYYY-MM-DD-YYYY-MM-DD.md`
- 月次（東京・月末夜）: `content/posts/YYYY/monthly/month-YYYY-MM.md`

## 使用するAPI
- OpenAI: `OPENAI_API_KEY` がある場合に本文生成（`/v1/chat/completions`）
- Pexels: `PEXELS_API_KEY` がある場合にカバー画像取得

## モデル選択（OpenAI）
優先順位:
1. `OPENAI_MODEL`（強制指定）
2. `OPENAI_PREFERRED_MODELS`（優先モデル配列。JSON配列 or カンマ区切り。未設定ならスキップ）
3. `config/ai-model.json` の `openai.defaultModel`
4. スクリプト内の既定優先リスト

例（PowerShell）:
```powershell
$env:OPENAI_API_KEY = "YOUR_API_KEY"
$env:OPENAI_PREFERRED_MODELS = '["gpt-5.2","gpt-5.1","gpt-5","gpt-4.1","gpt-4o-mini"]'
node scripts/generate.mjs
```

## 注意点
- 週次/月次は「その日にスクリプトが実行された場合のみ」生成されます。定期実行（GitHub Actions / タスクスケジューラ）で運用してください。
- `config/ai-model.json` は JSON としてパースされるので、必ず有効な JSON を保ってください。
