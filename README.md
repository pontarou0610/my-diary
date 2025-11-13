# ぽん次郎のゆる日記（Hugo）

都内在住の40代会社員・3児の父「ぽん次郎」の完全自動っぽい日記サイト。テーマは PaperMod 前提。仕事・お金・子育て・趣味をゆるく、野原ひろし風に綴ります。

## セットアップ

1) Hugo（extended）をインストール
- Windows: https://gohugo.io/installation/
- 確認: `hugo version`

2) テーマ PaperMod を追加（いずれか）
- Git submodule: `git submodule add https://github.com/adityatelange/hugo-PaperMod.git themes/PaperMod`
- または ZIP をダウンロードして `themes/PaperMod/` に展開

3) 開発サーバ
- `hugo server -D` で起動（下書き含む）

## 日次生成（PowerShell）

- `scripts/generate.ps1` が日次記事の雛形を作成します。
  - 今日分: `pwsh scripts/generate.ps1`
  - 任意日付: `pwsh scripts/generate.ps1 -Date 2025-01-03`
  - 生成後すぐ公開: `pwsh scripts/generate.ps1 -Publish`
  - OpenAIで本文生成: `pwsh scripts/generate.ps1 -UseAI`（公開も同時: `-Publish -UseAI`）

### OpenAI API の設定

- 環境変数に API キーを設定: `setx OPENAI_API_KEY "sk-..."`
- モデル指定は任意: `setx OPENAI_MODEL "gpt-4o-mini"`（未指定なら `gpt-4o-mini`）
- もしくは、リポジトリ直下に `.env` を置く
  - 例:
    - `OPENAI_API_KEY=sk-...`
    - `OPENAI_MODEL=gpt-4o-mini`

### Pexels（関連画像の自動取得）

- ローカル実行用: `setx PEXELS_API_KEY "pexels-..."`
- GitHub Actions: Settings → Secrets and variables → Actions に `PEXELS_API_KEY` を追加
- 概要:
  - 生成内容（趣味/子育て/仕事の文）から日本語クエリを作成し、Pexels API で横長1枚を取得
  - 画像は記事ファイルと同じフォルダに `cover.jpg` として保存
  - フロントマターに `[cover]` を自動追加（PaperModのカバー画像表示）

## 週間まとめ（任意）

- `scripts/weekly.ps1` が直近7本を拾ってまとめ記事を作成。
  - 例: `pwsh scripts/weekly.ps1`

## プロフィール

- `content/about/_index.md` を編集して自己紹介を更新。

## 備考

- プライバシー配慮のため、固有名詞や正確な地名は伏字推奨（例: △△区）。
- Archetype と Shortcode で「今日の学び」「一口メモ」「父ポイント」を装飾しています。

## GitHub Actions（毎日22:00 自動生成・公開）

- 仕組み
  - `.github/workflows/diary.yml` が毎日 22:00 JST に実行
  - `scripts/generate.mjs` が OpenAI API で記事を生成→コミット
  - Hugo でビルド→ `gh-pages` ブランチへデプロイ

- 事前準備
  - リポジトリ Settings → Pages: Source を `Deploy from a branch` に設定し、Branch を `gh-pages` に（初回実行後に選択可能）
  - Settings → Secrets and variables → Actions → New repository secret で追加
    - `OPENAI_API_KEY`: OpenAIのAPIキー
    - 任意 `OPENAI_MODEL`: 例 `gpt-4o-mini`
    - 任意 `PEXELS_API_KEY`: 関連画像（カバー）を自動取得したい場合

- 手動実行（テスト）
  - Actions タブ → `Diary - Generate, Build, Deploy` → `Run workflow`

- 注意
  - cron は UTC で `0 13 * * *`（= 22:00 JST）
  - テーマはサブモジュールで取得済み。Actions の checkout は `submodules: true` で取得します。

## 自動実行（毎日22:00）

- スケジュール登録（Windows タスク スケジューラ）
  - `pwsh scripts/schedule.ps1`（既定で毎日22:00に `-Publish -UseAI` 付きで実行）
  - 時刻変更: `pwsh scripts/schedule.ps1 -Time 22:30`
  - タスク名変更: `pwsh scripts/schedule.ps1 -TaskName PonjiroDiaryNightly`
