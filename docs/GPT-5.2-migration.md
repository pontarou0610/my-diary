# GPT-5.2 への移行手順

このドキュメントは、GPT-5 系モデルが使えるようになったときに、日記生成で優先的に使うための手順です。

## 使われるモデルの優先順位（`scripts/generate.mjs`）
`scripts/generate.mjs` は次の優先順で「使えるモデル」を試行します。

1. `OPENAI_MODEL`（強制指定。失敗したら次点へフォールバック）
2. `OPENAI_PREFERRED_MODELS`（優先モデル配列。JSON配列またはカンマ区切り。未設定ならスキップ）
3. `config/ai-model.json` の `openai.defaultModel`
4. スクリプト内の既定優先リスト（`gpt-5.2` → `gpt-5.1` → `gpt-5` → `gpt-4.1` → `gpt-4o-mini`）

## おすすめ手順（環境変数で制御）
### 1) 優先モデルを設定
PowerShell例（JSON配列）:
```powershell
$env:OPENAI_PREFERRED_MODELS = '["gpt-5.2","gpt-5.1","gpt-5","gpt-4.1","gpt-4o-mini"]'
```

### 2) 実行して動作確認
```powershell
$env:OPENAI_API_KEY = "YOUR_API_KEY"
pwsh scripts/generate.ps1 -UseAI
```

コンソールに `使用モデル: ...` が出ればOKです。

## 代替手順（設定ファイルで固定）
`config/ai-model.json` の `openai.defaultModel` を `gpt-5.2` に変更します。

## ロールバック
うまくいかない場合は、`OPENAI_PREFERRED_MODELS` を外すか、`openai.defaultModel` を `gpt-4o-mini` に戻してください。

