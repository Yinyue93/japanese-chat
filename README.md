# Japanese Chat Site (日本語チャットサイト)

リアルタイムメッセージング機能付きの日本語チャットサイトです。

## Features (機能)

- 🔐 ユーザーログインシステム
- 👑 管理者専用ログイン (`/admin`)
- 🏠 ラウンジページ - 利用可能な部屋の一覧表示
- 🚪 部屋作成機能 (定員2-15人、パスワード保護可能)
- 💬 リアルタイムチャット機能 (Socket.io使用)
- 🔒 パスワード保護部屋のサポート
- 🎨 美しいTailwind CSSデザイン
- 📁 ファイルベースストレージ (JSON)
- ♻️ 最後のユーザーが退室時の自動部屋削除

## Tech Stack (技術スタック)

- **Backend**: Node.js + Express.js
- **Real-time**: Socket.io
- **Frontend**: HTML5 + Tailwind CSS + Vanilla JavaScript
- **Storage**: File-based JSON storage
- **Fonts**: Noto Sans JP (Google Fonts)

## Installation & Setup (インストール・セットアップ)

### Prerequisites (前提条件)
- Node.js (v14 以上)
- npm

### Steps (手順)

1. **依存関係のインストール**
   ```bash
   npm install
   ```

2. **サーバー起動**
   ```bash
   npm start
   # または
   node server.js
   ```

3. **ブラウザでアクセス**
   ```
   http://localhost:3000
   ```

## Usage (使用方法)

### 一般ユーザー
1. メインページ (`/`) でユーザー名を入力してログイン
2. ラウンジページで既存の部屋に入室するか、新しい部屋を作成
3. リアルタイムでチャットを楽しむ
4. 「退室」ボタンでラウンジに戻る

### 管理者
1. `/admin` にアクセス
2. 管理者ID: `admin`
3. パスワード: `admin123`
4. 一般ユーザーと同じ機能を利用可能

## File Structure (ファイル構造)

```
japanese-chat/
├── server.js              # メインサーバーファイル
├── package.json           # npm設定
├── data/                  # データストレージ
│   ├── rooms.json         # 部屋データ
│   └── messages.json      # メッセージデータ
├── public/                # 静的ファイル
│   ├── login.html         # ログインページ
│   ├── admin-login.html   # 管理者ログイン
│   ├── lounge.html        # ラウンジページ
│   ├── create-room.html   # 部屋作成ページ
│   ├── password-prompt.html # パスワード入力
│   └── room.html          # チャットルーム
└── README.md              # このファイル
```

## API Endpoints

- `POST /api/login` - ユーザーログイン
- `POST /api/admin-login` - 管理者ログイン
- `GET /api/rooms` - 部屋一覧取得
- `POST /api/create-room` - 部屋作成
- `POST /api/join-room` - 部屋参加

## Socket.io Events

- `join-room` - 部屋への参加
- `send-message` - メッセージ送信
- `leave-room` - 部屋から退室
- `new-message` - 新しいメッセージ受信
- `user-joined` - ユーザー入室通知
- `user-left` - ユーザー退室通知

## Features Details (機能詳細)

### Room Management (部屋管理)
- 部屋名、定員(2-15人)、パスワード(任意)を設定可能
- 最後のユーザーが退室すると部屋は自動削除
- リアルタイムでの部屋一覧更新

### Chat Features (チャット機能)
- リアルタイムメッセージング
- メッセージは下から上に流れる表示
- ユーザー入退室の通知
- メッセージの時刻表示
- XSS対策のHTMLエスケープ処理

### Security (セキュリティ)
- XSS対策
- 管理者認証
- パスワード保護部屋

## Customization (カスタマイズ)

管理者認証情報を変更する場合は、`server.js` の以下の部分を編集してください：

```javascript
const ADMIN_ID = 'admin';
const ADMIN_PASSWORD = 'admin123';
```

## Browser Support (ブラウザサポート)

- Chrome (推奨)
- Firefox
- Safari
- Edge

## License

MIT License

---

**サーバーは現在 http://localhost:3000 で動作中です！** 