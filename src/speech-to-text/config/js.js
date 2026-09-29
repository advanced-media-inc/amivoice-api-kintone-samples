(function () {
    'use strict';

    var PLUGIN_ID = kintone.$PLUGIN_ID;
    // main.jsの送信先と同じURLにする。setProxyConfigの設定はURLの前方一致で適用される
    var RECOGNIZE_URL = 'https://acp-api.amivoice.com/v1/recognize';
    var config = kintone.plugin.app.getConfig(PLUGIN_ID);
    // 旧版はAPIキーをsetConfigに平文で保存していた。getConfigはアプリの利用者も呼べるため、保存時にsetProxyConfigへ移す
    var legacyApiKey = String(config.amivoiceApiKey || '').trim();
    // setConfigのフラグだけでなく、プロキシ設定にキーが実在するかも確かめる（アプリの再利用などで食い違った場合に入力を求めるため）
    var proxyConfig = kintone.plugin.app.getProxyConfig(RECOGNIZE_URL, 'POST');
    var isConfigured = config.apiKeyConfigured === 'true' &&
        !!(proxyConfig && proxyConfig.headers && proxyConfig.headers.Authorization);

    // APIキーは画面に表示しない。設定済みかどうかだけを示す
    if (isConfigured) {
        document.getElementById('apiKeyStatus').textContent = '設定済みです。変更する場合だけ入力してください。';
    } else if (legacyApiKey) {
        // 移行前はレコード画面で認識が止まっているため、保存が必要なことを明示する
        document.getElementById('apiKeyStatus').textContent = '以前の版で保存したAPIキーがあります。「保存」を押すと新しい保存先へ移ります（押すまで文字起こしは実行されません）。';
    }

    function saveConfig() {
        // setConfigは設定全体を置き換えるため、amivoiceApiKeyを含めないことで旧版のキーが消える
        kintone.plugin.app.setConfig({
            apiKeyConfigured: 'true',
            audioFieldCode: config.audioFieldCode || '',
            resultFieldCode: config.resultFieldCode || '',
            responseFieldCode: config.responseFieldCode || '',
            statusFieldCode: config.statusFieldCode || ''
        });
    }

    document.getElementById('save').onclick = function () {
        var apiKey = document.getElementById('amivoiceApiKey').value.trim() || legacyApiKey;
        if (apiKey) {
            // kintoneのプロキシがサーバー側でヘッダーを付けるため、APIキーは利用者のブラウザに渡らない
            kintone.plugin.app.setProxyConfig(RECOGNIZE_URL, 'POST', {
                Authorization: 'Bearer ' + apiKey
            }, {}, saveConfig);
            return;
        }
        if (isConfigured) {
            saveConfig();
            return;
        }
        window.alert('APIキーを入力してください。');
    };

    document.getElementById('cancel').onclick = function () {
        history.back();
    };
})();
