# GPT-5.1 への移行手順

このドキュメントでは、GPT-5.1がAPI公開された際の移行手順を説明します。

## 🎯 移行の簡単さ

**設定ファイル1箇所を変更するだけで完了します！**

## 📝 移行手順

### 1. 設定ファイルの更新

`config/ai-model.json` を開き、`defaultModel` を変更します：

```json
{
  "openai": {
    "defaultModel": "gpt-5.1",  // ← ここを "gpt-4o" から "gpt-5.1" に変更
    "models": {
      "gpt-4o": {
        "name": "gpt-4o",
        "description": "旧デフォルトモデル",
        "maxTokens": 1600,
        "temperature": 0.9
      },
      "gpt-5.1": {
        "name": "gpt-5.1",
        "description": "GPT-5.1 (API公開後に使用可能)",
        "maxTokens": 2000,
        "temperature": 0.9
      }
    }
  }
}
```

### 2. 動作確認

ローカルでテスト実行します：

```powershell
pwsh scripts/generate.ps1 -UseAI
```

コンソールに以下のように表示されれば成功です：

```
使用モデル: gpt-5.1 (設定ファイルから読み込み)
```

### 3. コミット & プッシュ

```bash
git add config/ai-model.json
git commit -m "GPT-5.1に移行"
git push
```

これで、GitHub Actionsでの自動生成もGPT-5.1を使用するようになります。

## 🔧 パラメータの調整（オプション）

GPT-5.1のパフォーマンスに応じて、以下のパラメータを調整できます：

- **maxTokens**: 生成する最大トークン数（デフォルト: 2000）
- **temperature**: 生成の多様性（0.0〜2.0、デフォルト: 0.9）

```json
"gpt-5.1": {
  "name": "gpt-5.1",
  "description": "GPT-5.1",
  "maxTokens": 2500,      // ← より長い文章を生成
  "temperature": 0.8      // ← より一貫性のある文章
}
```

## 🔄 ロールバック方法

もし問題が発生した場合、`defaultModel` を `"gpt-4o"` に戻すだけで元に戻ります：

```json
{
  "openai": {
    "defaultModel": "gpt-4o",  // ← 元に戻す
    ...
  }
}
```

## 📊 モデル選択の優先順位

システムは以下の優先順位でモデルを選択します：

1. **コマンドライン引数** `-Model gpt-5.1`
2. **環境変数** `OPENAI_MODEL=gpt-5.1`
3. **設定ファイル** `config/ai-model.json` の `defaultModel`

環境変数で一時的に別のモデルを試すこともできます：

```powershell
$env:OPENAI_MODEL = "gpt-4o"
pwsh scripts/generate.ps1 -UseAI
```

## ✅ チェックリスト

- [ ] `config/ai-model.json` の `defaultModel` を `"gpt-5.1"` に変更
- [ ] ローカルでテスト実行（`pwsh scripts/generate.ps1 -UseAI`）
- [ ] 生成された記事の品質を確認
- [ ] 必要に応じて `maxTokens` や `temperature` を調整
- [ ] 変更をコミット & プッシュ
- [ ] GitHub Actionsでの自動生成を確認

## 💡 Tips

- **段階的な移行**: まず環境変数で試してから、設定ファイルを更新することをお勧めします
- **コスト管理**: GPT-5.1のAPI料金を確認し、`maxTokens` を適切に設定してください
- **品質比較**: 数日間、両モデルで生成した記事を比較してみてください
