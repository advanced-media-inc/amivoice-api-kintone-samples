AmiVoiceユーザー辞書登録機能の要件定義
概要：表形式で表示した単語一覧を、辞書登録APIを用いて一括登録するGUIアプリ。新規に単語一覧の表を作ること、および、すでに登録されている単語を読み出して編集、追加することができる。単語登録はエンジンごとに可能で、プロファイルID（profileID）で分けることができる

１　単語一覧を表示するためのユーザ入力
　１）　APIキー：登録単語の読み出し、上書き登録に用いる
　２）　登録先エンジン名のリスト（エンジン名（表示用）と接続エンジン名（APIパラメータ））

エンジン名	接続エンジン名
日本語E2E_汎用	-a2-ja-general
中国語E2E_汎用	-a2-zh-general
多言語E2E_汎用	-a2-multi-general
日本語E2E_汎用バッチ	-a2b-ja-general
中国語E2E_汎用バッチ	-a2b-zh-general
多言語E2E_汎用バッチ	-a2b-multi-general
会話_汎用	-a-general
会話_医療	-a-medical
会話_金融	-a-bizfinance
会話_保険	-a-bizinsurance
英語_汎用	-a-general-en

　３）プロファイルID入力（登録済のprofileIDを選択するか新規にフリー入力（半角アルファベットと数字、ハイフン、アンダースコアで構成））

　４）　登録単語セット　表記、読み、クラス
　　クラスの選択肢=

    {
      "classnames": [
        "固有名詞",
        "名前",
        "名前(名)",
        "駅名",
        "地名",
        "会社名",
        "部署名",
        "役職名",
        "記号",
        "括弧開き",
        "括弧閉じ",
        "元号"
      ]
    }
  ５）　アクションボタン
  　profileIDの読み出しボタン、登録単語の読み出しボタン、登録ボタン

２　GUI仕様
　表の項目：
　タイトル行：表記、読み、クラス
　登録単語行：表記入力ボックス、読み入力ボックス、クラス入力ボックス（クラス選択肢のドロップダウンリスト）

３ 単語登録APIのインターフェース仕様
 　下記マニュアルを参照
　https://docs.amivoice.com/amivoice-api/manual/user-dictionary-api
https://docs.amivoice.com/amivoice-api/reference/profilewords/get-profile-words
https://docs.amivoice.com/amivoice-api/reference/profilewords/get-profiles
https://docs.amivoice.com/amivoice-api/reference/profilewords/set-profile-words

４　ユースケース
　１）新規のprofileIDに登録単語をリストとして登録する
　　APIキーを入力する
　　任意のprofileIDを入力する
　　表に登録したい単語の表記、読みを入力し、クラスを選択する
　　登録ボタンを押す

　２）既存のprofileIDに登録されている単語を編集・追記する
　　APIキーを入力する
　　profileIDの読み出しボタンを押す
　　profileIDを選択する
　　登録単語を表に読み出す
　　表の単語の表記、読みを入力し、クラスを編集する。　　 
　　登録ボタンを押す


