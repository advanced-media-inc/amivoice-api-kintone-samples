(function () {
    'use strict';

    var PLUGIN_ID = kintone.$PLUGIN_ID;
    var config = kintone.plugin.app.getConfig(PLUGIN_ID);

    document.getElementById('amivoiceApiKey').value = config.amivoiceApiKey || '';

    document.getElementById('save').onclick = function () {
        kintone.plugin.app.setConfig({
            amivoiceApiKey: document.getElementById('amivoiceApiKey').value,
            audioFieldCode: config.audioFieldCode || '',
            resultFieldCode: config.resultFieldCode || '',
            responseFieldCode: config.responseFieldCode || '',
            statusFieldCode: config.statusFieldCode || ''
        });
    };

    document.getElementById('cancel').onclick = function () {
        kintone.plugin.app.setConfig(config);
    };
})();
