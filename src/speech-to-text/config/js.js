(function (PLUGIN_ID) {
    'use strict';

    // /v1/recognize（ログ保存あり）と /v1/nolog/recognize（ログ保存なし）の両方に前方一致させる
    var PROXY_URL = 'https://acp-api.amivoice.com/v1/';
    // 以前の版が保存したURL。前方一致では長く一致する設定が優先されるため、残っていれば同じキーで上書きする
    var LEGACY_PROXY_URL = 'https://acp-api.amivoice.com/v1/recognize';
    var config = kintone.plugin.app.getConfig(PLUGIN_ID);

    function getSavedAuthorization(url) {
        var proxyConfig = kintone.plugin.app.getProxyConfig(url, 'POST');
        return (proxyConfig && proxyConfig.headers && proxyConfig.headers.Authorization) || '';
    }

    var hasLegacyProxyConfig = !!kintone.plugin.app.getProxyConfig(LEGACY_PROXY_URL, 'POST');
    var savedAuthorization = getSavedAuthorization(PROXY_URL) || getSavedAuthorization(LEGACY_PROXY_URL);
    // 旧バージョンがsetConfigに平文で保存していたキー。保存時にsetProxyConfigへ移し、setConfigからは消す
    var legacyKey = config.amivoiceApiKey || '';
    var apiKeyInput = document.getElementById('amivoiceApiKey');
    var apiKeyStatus = document.getElementById('apiKeyStatus');

    if (savedAuthorization) {
        apiKeyStatus.textContent = 'APIキーは設定済みです。変更する場合のみ入力してください。';
    } else if (legacyKey) {
        apiKeyStatus.textContent = '旧バージョンで保存したAPIキーがあります。保存すると安全な保存先へ移行します。';
    } else {
        apiKeyStatus.textContent = 'APIキーが未設定です。';
    }

    function setAuthorization(url, authorization) {
        return new Promise(function (resolve) {
            kintone.plugin.app.setProxyConfig(url, 'POST', { Authorization: authorization }, {}, resolve);
        });
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
        var inputKey = apiKeyInput.value.trim();
        var authorization = inputKey
            ? 'Bearer ' + inputKey
            : (savedAuthorization || (legacyKey ? 'Bearer ' + legacyKey : ''));
        if (!authorization) {
            window.alert('AmiVoice API Keyを入力してください。');
            return;
        }
        // キーが変わらなくても書き直し、以前の版の保存先から新しいURLへ移行させる
        setAuthorization(PROXY_URL, authorization)
            .then(function () {
                return hasLegacyProxyConfig ? setAuthorization(LEGACY_PROXY_URL, authorization) : null;
            })
            .then(saveConfig);
    };

    document.getElementById('cancel').onclick = function () {
        window.history.back();
    };
})(kintone.$PLUGIN_ID);
