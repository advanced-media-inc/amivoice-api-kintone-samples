/* global kintone */
(function () {
    'use strict';

    var API_BASE_URL = 'https://acp.amivoice.com/util/api/downloadusage/';
    var BUTTON_ID = 'amivoice-download-usage-button';

    function fieldValue(record, fieldCode) {
        var field = record && record[fieldCode];
        return field && field.value != null ? String(field.value).trim() : '';
    }

    function parseCsvLine(line) {
        var values = [];
        var value = '';
        var quoted = false;
        for (var index = 0; index < line.length; index += 1) {
            var character = line[index];
            if (character === '"') {
                if (quoted && line[index + 1] === '"') {
                    value += '"';
                    index += 1;
                } else {
                    quoted = !quoted;
                }
            } else if (character === ',' && !quoted) {
                values.push(value);
                value = '';
            } else {
                value += character;
            }
        }
        values.push(value);
        return values;
    }

    function parseCsv(csv) {
        return String(csv || '')
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/)
            .filter(function (line) { return line.trim() !== ''; })
            .map(parseCsvLine);
    }

    function getTableCodes(record, tableCode) {
        var table = record && record[tableCode];
        var firstRow = table && table.value && table.value[0];
        return firstRow && firstRow.value ? Object.keys(firstRow.value) : [];
    }

    function findCode(codes, patterns, fallbackIndex) {
        var found = codes.find(function (code) {
            return patterns.some(function (pattern) { return pattern.test(code); });
        });
        return found || codes[fallbackIndex];
    }

    function makeQuantityRows(record, rows) {
        var codes = getTableCodes(record, 'quantity_table');
        var columns = [
            findCode(codes, [/yyyymm/i, /year/i, /month/i, /年月/], 0),
            findCode(codes, [/account/i, /アカウント/], 1),
            findCode(codes, [/engine/i, /plan/i, /エンジン/], 2),
            findCode(codes, [/ms/i, /msec/i, /ミリ秒/, /使用量/], 3)
        ];
        return rows.map(function (values) {
            var row = {};
            columns.forEach(function (code, index) {
                if (code) row[code] = { value: values[index] || '' };
            });
            return { value: row };
        });
    }

    function makeCostRows(record, rows) {
        var codes = getTableCodes(record, 'cost_table');
        var columns = [
            findCode(codes, [/engine/i, /plan/i, /エンジン/], 0),
            findCode(codes, [/cost/i, /price/i, /料金/, /金額/], 1)
        ];
        return rows.map(function (values) {
            var row = {};
            columns.forEach(function (code, index) {
                if (code) row[code] = { value: values[index] || '' };
            });
            return { value: row };
        });
    }

    function requestUsageCsv(apiKey, serviceId, yyyymm) {
        var normalizedServiceId = String(serviceId).trim();
        var prefix = normalizedServiceId.endsWith('01') ? '' : 'Ami.';
        var url = API_BASE_URL + encodeURIComponent(prefix + normalizedServiceId) + '/' + encodeURIComponent(yyyymm);
        return new Promise(function (resolve, reject) {
            kintone.proxy(url, 'GET', {
                Authorization: 'Bearer ' + apiKey
            }, {}, function (body, status) {
                if (status < 200 || status >= 300) {
                    reject(new Error('使用量CSV取得失敗: HTTP ' + status + ' ' + body));
                    return;
                }
                resolve(body);
            }, reject);
        });
    }

    function updateRecord(appId, recordId, record) {
        return kintone.api(
            kintone.api.url('/k/v1/record.json', true),
            'PUT',
            { app: appId, id: recordId, record: record }
        );
    }

    function maskApiKeyField() {
        var fieldElement = kintone.app.record.getFieldElement('apikey');
        if (!fieldElement) return;
        fieldElement.innerHTML = '<span class="control-value-gaia">********</span>';
        window.setTimeout(function () {
            var currentFieldElement = kintone.app.record.getFieldElement('apikey');
            if (currentFieldElement) {
                currentFieldElement.innerHTML = '<span class="control-value-gaia">********</span>';
            }
        }, 0);
    }

    function maskApiKeyInIndex() {
        var fieldElements = kintone.app.getFieldElements('apikey') || [];
        fieldElements.forEach(function (fieldElement) {
            fieldElement.textContent = '********';
        });
    }

    function usePasswordInputForApiKey() {
        var fieldElement = kintone.app.record.getFieldElement('apikey');
        var input = fieldElement && fieldElement.querySelector('input');
        if (input) input.type = 'password';
    }

    async function downloadUsage(event) {
        var record = event.record;
        var apiKey = fieldValue(record, 'apikey');
        var serviceId = fieldValue(record, 'serviceid');
        var yyyymm = fieldValue(record, 'date');
        if (!apiKey || !serviceId || !/^\d{6}$/.test(yyyymm)) {
            window.alert('apikey、serviceid、date（YYYYMM）を入力してください。');
            return event;
        }

        var button = document.getElementById(BUTTON_ID);
        if (button) button.disabled = true;
        try {
            var lines = parseCsv(await requestUsageCsv(apiKey, serviceId, yyyymm));
            var quantityRows = [];
            var costByPlan = {};
            lines.slice(1).forEach(function (values) {
                var account = String(values[1] || '').trim();
                var plan = String(values[2] || '').trim();
                var milliseconds = String(values[3] || '').trim();
                var cost = String(values[4] || '').trim();
                var isCostRow = account.endsWith('01') && cost !== '' && milliseconds === '';
                if (isCostRow) {
                    costByPlan[plan] = (costByPlan[plan] || 0) + (Number(cost.replace(/,/g, '')) || 0);
                    return;
                }
                quantityRows.push(values.slice(0, 4));
            });

            var costRows = Object.keys(costByPlan).map(function (plan) {
                return [plan, String(costByPlan[plan])];
            });
            await updateRecord(kintone.app.getId(), event.recordId, {
                quantity_table: { value: makeQuantityRows(record, quantityRows) },
                cost_table: { value: makeCostRows(record, costRows) }
            });
            window.alert('料金明細を更新しました。');
            window.location.reload();
        } catch (error) {
            console.error('[AmiVoice cost manager]', error);
            window.alert('料金明細の取得に失敗しました: ' + (error.message || error));
        } finally {
            if (button) button.disabled = false;
        }
        return event;
    }

    kintone.events.on('app.record.detail.show', function (event) {
        maskApiKeyField();
        var space = kintone.app.record.getHeaderMenuSpaceElement();
        if (!space || document.getElementById(BUTTON_ID)) return event;
        var button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = '料金明細を取得';
        button.className = 'kintoneplugin-button-normal';
        button.addEventListener('click', function () { downloadUsage(event); });
        space.appendChild(button);
        return event;
    });

    kintone.events.on('app.record.index.show', function (event) {
        maskApiKeyInIndex();
        return event;
    });

    kintone.events.on(['app.record.create.show', 'app.record.edit.show'], function (event) {
        usePasswordInputForApiKey();
        return event;
    });
}());
