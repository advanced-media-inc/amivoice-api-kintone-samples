(function () {
    'use strict';

    var PLUGIN_ID = kintone.$PLUGIN_ID;
    // main.jsの送信先と同じURLにする。setProxyConfigの設定はURLの前方一致で適用される
    var RECOGNIZE_URL = 'https://acp-api.amivoice.com/v1/recognize';
    var config = kintone.plugin.app.getConfig(PLUGIN_ID);
    // 旧版はAPIキーをsetConfigに平文で保存していた。getConfigはアプリの利用者も呼べるため、保存時にsetProxyConfigへ移す
    var legacyApiKey = String(config.amivoiceApiKey || '').trim();
    var isConfigured = config.apiKeyConfigured === 'true';

    // APIキーは画面に表示しない。設定済みかどうかだけを示す
    if (isConfigured || legacyApiKey) {
        document.getElementById('apiKeyStatus').textContent = '設定済みです。変更する場合だけ入力してください。';
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
