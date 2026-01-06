# 無料・APIキー不要な音声読み上げ（TTS）の実装方法

現在開発中の「システム英単語学習アプリ」で使用している、APIキー不要で無料で利用できる音声読み上げの実装方法です。
他のアプリ開発でも再利用できるように手順をまとめました。

## 概要
Google Cloud Text-to-Speech APIなどの有料サービスやAPIキー発行が必要なサービスを使用せず、**Youdao Dictionary** の公開エンドポイントを利用して、無料で自然な英語音声を再生します。
また、オフライン時やAPIエラー時の保険として、ブラウザ標準の **Web Speech API** をフォールバック（予備）として実装します。

## 1. 使用する音声ソース (Youdao Dictionary)

**基本URL**: `https://dict.youdao.com/dictvoice`

### 必須パラメータ
| パラメータ名 | 説明 | 設定例 |
| :--- | :--- | :--- |
| `audio` | 読み上げたいテキスト。URLエンコードが必要です。 | `encodeURIComponent('apple')` |
| `type` | 英語の種類（アクセント）。 | `1`: イギリス英語<br>`2`: アメリカ英語 |

### URL生成例
```javascript
// 「apple」をアメリカ英語で再生する場合
https://dict.youdao.com/dictvoice?audio=apple&type=2
```

---

## 2. 実装コード例 (JavaScript)

以下の関数 `playAudio(text)` をコピーして利用してください。

```javascript
/**
 * 指定されたテキストを読み上げます。
 * まずYoudaoのオンライン音声の再生を試み、失敗した場合（オフライン等）は
 * ブラウザ標準のWeb Speech APIを使用します。
 * 
 * @param {string} text - 読み上げる英単語や文章
 */
function playAudio(text) {
    if (!text) return;

    // 1. Youdao APIのURLを作成 (type=2 はアメリカ英語)
    const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=2`;
    
    // 2. Audioオブジェクトを作成
    const audio = new Audio(audioUrl);

    // 3. 再生を試みる
    const playPromise = audio.play();

    // 4. エラーハンドリング（フォールバック処理）
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.warn('オンライン音声(Youdao)の再生に失敗しました。システム標準TTSに切り替えます:', error);
            
            // フォールバック: ブラウザ標準のWeb Speech APIを使用
            playSystemTTS(text);
        });
    }
}

/**
 * フォールバック用: ブラウザ標準のTTSで再生
 */
function playSystemTTS(text) {
    // 既に再生中のものをキャンセル（連打対策）
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US'; // 言語設定: アメリカ英語
    
    // 必要に応じて速度や高さを調整可能
    // utterance.rate = 1.0; 
    // utterance.pitch = 1.0;

    window.speechSynthesis.speak(utterance);
}
```

## 3. 実装のポイント
1.  **非同期処理とPromise**: `audio.play()` は Promise を返します。ブラウザのセキュリティポリシー（自動再生制限など）やネットワークエラーで失敗する可能性があるため、必ず `.catch()` でエラーを捕捉します。
2.  **フォールバックの重要性**: 無料の外部サービスを利用するため、サービスダウンやネットワーク環境に左右されます。必ず `Web Speech API` (`speechSynthesis`) を予備として用意し、UXを損なわないようにします。
3.  **エンコード**: `encodeURIComponent()` を使用することで、スペースや特殊文字が含まれる文章でも正しくURL化できます。

## 4. 利用条件・注意点
- **利用制限**: 公開されている辞書サービスの音声機能を利用しているため、大量の連続リクエスト（スクレイピングなど）は避け、ユーザーアクション（ボタンクリックなど）ごとの再生に留めてください。
- **商用利用**: あくまで個人開発や学習用アプリでの利用を想定しています。大規模な商用アプリの場合は、正式にGoogle Cloud TTSやAmazon Pollyなどの契約を検討してください。
