(function (PLUGIN_ID) {
    'use strict';

    // js/main.jsの送信先と前方一致しないと、保存したヘッダーがリクエストに付かない
    var RECOGNIZE_URL = 'https://acp-api.amivoice.com/v1/recognize';
    var config = kintone.plugin.app.getConfig(PLUGIN_ID);
    var proxyConfig = kintone.plugin.app.getProxyConfig(RECOGNIZE_URL, 'POST');
    var hasSavedKey = !!(proxyConfig && proxyConfig.headers && proxyConfig.headers.Authorization);
    // 旧バージョンがsetConfigに平文で保存していたキー。保存時にsetProxyConfigへ移し、setConfigからは消す
    var legacyKey = config.amivoiceApiKey || '';
    var apiKeyInput = document.getElementById('amivoiceApiKey');
    var apiKeyStatus = document.getElementById('apiKeyStatus');

    if (hasSavedKey) {
        apiKeyStatus.textContent = 'APIキーは設定済みです。変更する場合のみ入力してください。';
    } else if (legacyKey) {
        apiKeyStatus.textContent = '旧バージョンで保存したAPIキーがあります。保存すると安全な保存先へ移行します。';
    } else {
        apiKeyStatus.textContent = 'APIキーが未設定です。';
    }

    function saveConfig() {
        kintone.plugin.app.setConfig({
            apiKeyConfigured: 'true',
            audioFieldCode: config.audioFieldCode || '',
            resultFieldCode: config.resultFieldCode || '',
            responseFieldCode: config.responseFieldCode || '',
            statusFieldCode: config.statusFieldCode || ''
        });
    }

    document.getElementById('save').onclick = function () {
        var apiKey = apiKeyInput.value.trim() || (hasSavedKey ? '' : legacyKey);
        if (!apiKey) {
            if (!hasSavedKey) {
                window.alert('AmiVoice API Keyを入力してください。');
                return;
            }
            saveConfig();
            return;
        }
        kintone.plugin.app.setProxyConfig(
            RECOGNIZE_URL,
            'POST',
            { Authorization: 'Bearer ' + apiKey },
            {},
            saveConfig
        );
    };

    document.getElementById('cancel').onclick = function () {
        window.history.back();
    };
})(kintone.$PLUGIN_ID);
