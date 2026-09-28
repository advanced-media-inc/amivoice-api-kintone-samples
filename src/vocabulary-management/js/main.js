/* global kintone */
(function () {
    'use strict';

    var API_BASE_URL = 'https://acp-api.amivoice.com';
    var FIELD = {
        apiKey: 'api_key',
        engine: 'engine_name',
        profileId: 'profile_id',
        sampleRate: 'sample_rate',
        table: 'word_table',
        written: 'word_written',
        spoken: 'word_reading',
        className: 'word_class',
        biasing: 'word_biasing'
    };
    var ENGINE_MAP = {
        '日本語E2E_汎用': '-a2-ja-general',
        '中国語E2E_汎用': '-a2-zh-general',
        '多言語E2E_汎用': '-a2-multi-general',
        '日本語E2E_汎用バッチ': '-a2b-ja-general',
        '中国語E2E_汎用バッチ': '-a2b-zh-general',
        '多言語E2E_汎用バッチ': '-a2b-multi-general',
        '会話_汎用': '-a-general',
        '会話_医療': '-a-medical',
        '会話_金融': '-a-bizfinance',
        '会話_保険': '-a-bizinsurance'
    };
    // word_class(DROP_DOWN)の選択肢と一致しない値を渡すとkintoneがエラーにするため、既知の選択肢だけを通す
    var CLASS_NAME_CHOICES = [
        '固有名詞', '名前', '名前(名)', '駅名', '地名', '会社名', '部署名', '役職名', '記号', '括弧開き', '括弧閉じ', '元号'
    ];
    var PROFILE_SELECT_ID = 'amivoice-profile-id-select';
    var STATUS_ID = 'amivoice-word-register-status';

    function getCurrentRecord() {
        var state = kintone.app.record.get();
        return state && state.record;
    }

    function fieldValue(record, fieldCode) {
        return record && record[fieldCode] ? String(record[fieldCode].value || '').trim() : '';
    }

    function setStatus(message, isError) {
        var element = document.getElementById(STATUS_ID);
        if (!element) {
            return;
        }
        element.textContent = message;
        element.style.color = isError ? '#b42318' : '#067647';
    }

    function showError(error) {
        var message = error && error.message ? error.message : String(error);
        setStatus(message, true);
        window.alert(message);
    }

    function getEngine(record) {
        var displayName = fieldValue(record, FIELD.engine);
        return ENGINE_MAP[displayName] || displayName;
    }

    function isE2eEngine(record) {
        return /^-a2/.test(getEngine(record));
    }

    function getApiKey(record) {
        return fieldValue(record, FIELD.apiKey);
    }

    function getProfileId(record) {
        return fieldValue(record, FIELD.profileId);
    }

    // ハイブリッドエンジンは8k/16kでプロファイルが別物のため、未指定時のデフォルト(16k)以外はadfを付ける
    function withAdfQuery(path, record) {
        if (isE2eEngine(record)) {
            return path;
        }
        var sampleRate = fieldValue(record, FIELD.sampleRate);
        return sampleRate ? path + '?adf=' + encodeURIComponent(sampleRate) : path;
    }

    function requestAmiVoice(path, method, apiKey, body) {
        var headers = {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
        };
        return kintone.proxy(
            API_BASE_URL + path,
            method,
            headers,
            body ? JSON.stringify(body) : {}
        ).then(function (response) {
            var responseBody = response[0];
            var status = Number(response[1]);
            if (status < 200 || status >= 300) {
                throw new Error('AmiVoice API error: HTTP ' + status + ' ' + responseBody);
            }
            if (!responseBody) {
                return {};
            }
            try {
                return JSON.parse(responseBody);
            } catch (error) {
                throw new Error('AmiVoice API returned invalid JSON');
            }
        });
    }

    function validateRecord(record, requireProfile) {
        if (!getApiKey(record)) {
            throw new Error('APIキーを入力してください。');
        }
        if (!getEngine(record)) {
            throw new Error('登録先エンジンを選択してください。');
        }
        if (getEngine(record) === '-a-general-en') {
            throw new Error('英語エンジンはAmiVoiceのユーザー辞書登録に対応していません。');
        }
        if (requireProfile && !getProfileId(record)) {
            throw new Error('profileIDを入力または選択してください。');
        }
        if (requireProfile && !/^[A-Za-z0-9_-]+$/.test(getProfileId(record))) {
            throw new Error('profileIDは半角英数字、ハイフン、アンダースコアだけで入力してください。');
        }
    }

    function extractProfiles(response) {
        var profileIds = response && response.profileids;
        return Array.isArray(profileIds) ? profileIds : [];
    }

    function readProfiles() {
        var record = getCurrentRecord();
        validateRecord(record, false);
        setStatus('profileIDを取得中...');
        var path = withAdfQuery('/profilewords/' + encodeURIComponent(getEngine(record)) + '/', record);
        return requestAmiVoice(path, 'GET', getApiKey(record)).then(function (response) {
            var profiles = extractProfiles(response);
            var select = document.getElementById(PROFILE_SELECT_ID);
            if (!select) {
                return;
            }
            select.innerHTML = '<option value="">profileIDを選択</option>';
            profiles.forEach(function (profileId) {
                var option = document.createElement('option');
                option.value = profileId;
                option.textContent = profileId;
                select.appendChild(option);
            });
            setStatus(profiles.length + '件のprofileIDを取得しました。');
        });
    }

    function wordsFromResponse(response) {
        return Array.isArray(response.profilewords) ? response.profilewords : [];
    }

    function sanitizeClassName(classname) {
        var trimmed = String(classname || '').trim();
        return CLASS_NAME_CHOICES.indexOf(trimmed) >= 0 ? trimmed : '';
    }

    function tableRowsFromWords(words) {
        return words.map(function (word) {
            var row = {};
            row[FIELD.written] = {
                type: 'SINGLE_LINE_TEXT',
                value: word.written || ''
            };
            row[FIELD.spoken] = {
                type: 'SINGLE_LINE_TEXT',
                value: word.spoken || word.alternativewritten || ''
            };
            row[FIELD.className] = {
                type: 'DROP_DOWN',
                value: sanitizeClassName(word.classname)
            };
            row[FIELD.biasing] = {
                type: 'SINGLE_LINE_TEXT',
                value: word.biasing != null ? String(word.biasing) : ''
            };
            return { value: row };
        });
    }

    function readWords() {
        var record = getCurrentRecord();
        validateRecord(record, true);
        setStatus('登録単語を取得中...');
        var path = withAdfQuery('/profilewords/' + encodeURIComponent(getEngine(record)) + '/' + encodeURIComponent(getProfileId(record)), record);
        return requestAmiVoice(path, 'GET', getApiKey(record)).then(function (response) {
            var currentRecord = getCurrentRecord();
            if (currentRecord && currentRecord[FIELD.table]) {
                currentRecord[FIELD.table].value = tableRowsFromWords(wordsFromResponse(response));
                kintone.app.record.set({ record: currentRecord });
            }
            setStatus(wordsFromResponse(response).length + '件の単語を読み込みました。');
        });
    }

    function wordsFromRecord(record) {
        var table = record && record[FIELD.table] ? record[FIELD.table].value : [];
        var isE2E = isE2eEngine(record);
        return table.map(function (row) {
            var values = row.value || {};
            var written = fieldValue(values, FIELD.written);
            var spoken = fieldValue(values, FIELD.spoken);
            var className = fieldValue(values, FIELD.className);
            var biasingText = fieldValue(values, FIELD.biasing);
            if (!written && !spoken && !className && !biasingText) {
                return null;
            }
            var word;
            if (isE2E) {
                if (!written) {
                    throw new Error('表記を入力してください。');
                }
                word = { written: written };
                if (spoken) {
                    word.alternativewritten = spoken;
                }
                if (biasingText) {
                    var biasing = Number(biasingText);
                    if (Number.isNaN(biasing) || biasing < 0 || biasing > 1) {
                        throw new Error('単語強調度は0から1の数値で入力してください。');
                    }
                    word.biasing = biasing;
                }
            } else {
                if (!written || !spoken) {
                    throw new Error('表記と読みは両方入力してください。');
                }
                word = { written: written, spoken: spoken };
                if (className) {
                    word.classname = className;
                }
            }
            return word;
        }).filter(Boolean);
    }

    function registerWords() {
        var record = getCurrentRecord();
        validateRecord(record, true);
        var words = wordsFromRecord(record);
        // 登録APIは辞書全体を置き換えるため、0件で送ると登録済みの単語がすべて消える
        if (words.length === 0 && !window.confirm(
            '登録する単語が0件です。\nprofileID「' + getProfileId(record) + '」に登録済みの単語はすべて削除されます。よろしいですか？'
        )) {
            setStatus('登録を中止しました。');
            return;
        }
        var path = withAdfQuery('/profilewords/' + encodeURIComponent(getEngine(record)) + '/' + encodeURIComponent(getProfileId(record)), record);
        setStatus(words.length + '件を登録中...');
        return requestAmiVoice(path, 'POST', getApiKey(record), { profilewords: words }).then(function () {
            setStatus(words.length + '件を登録しました。');
        });
    }

    function addButton(container, label, handler) {
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.className = 'gaia-ui-actionmenu-save';
        button.style.marginRight = '8px';
        button.addEventListener('click', function () {
            button.disabled = true;
            Promise.resolve().then(handler).catch(showError).then(function () {
                button.disabled = false;
            });
        });
        container.appendChild(button);
    }

    function addProfileSelector(container) {
        var select = document.createElement('select');
        select.id = PROFILE_SELECT_ID;
        select.style.marginRight = '8px';
        select.innerHTML = '<option value="">profileIDを選択</option>';
        select.addEventListener('change', function () {
            var record = getCurrentRecord();
            if (record && record[FIELD.profileId]) {
                record[FIELD.profileId].value = select.value;
                kintone.app.record.set({ record: record });
            }
        });
        container.appendChild(select);
    }

    function addApiKeyNotice() {
        var fieldElement = kintone.app.record.getFieldElement(FIELD.apiKey);
        if (!fieldElement || document.getElementById('amivoice-api-key-notice')) {
            return;
        }
        var notice = document.createElement('div');
        notice.id = 'amivoice-api-key-notice';
        notice.textContent = 'APIキーはレコード保存時に保存されません。';
        notice.style.marginTop = '4px';
        notice.style.color = '#b42318';
        notice.style.fontSize = '12px';
        fieldElement.appendChild(notice);
    }

    function usePasswordInputForApiKey(retryCount) {
        var fieldElement = kintone.app.record.getFieldElement(FIELD.apiKey);
        var input = fieldElement && fieldElement.querySelector('input');
        if (input) {
            input.type = 'password';
            return;
        }
        if ((retryCount || 0) < 5) {
            window.setTimeout(function () {
                usePasswordInputForApiKey((retryCount || 0) + 1);
            }, 100);
        }
    }

    function addUi(event) {
        addApiKeyNotice();
        usePasswordInputForApiKey();
        var container = kintone.app.record.getHeaderMenuSpaceElement();
        if (!container || document.getElementById(STATUS_ID)) {
            return event;
        }
        var status = document.createElement('span');
        status.id = STATUS_ID;
        status.style.marginLeft = '8px';
        status.style.fontSize = '13px';
        container.appendChild(status);
        addProfileSelector(container);
        addButton(container, 'profileID読み出し', readProfiles);
        addButton(container, '登録単語読み出し', readWords);
        addButton(container, '登録', registerWords);
        return event;
    }

    function clearApiKeyBeforeSave(event) {
        if (event.record && event.record[FIELD.apiKey]) {
            event.record[FIELD.apiKey].value = '';
        }
        return event;
    }

    kintone.events.on([
        'app.record.create.show',
        'app.record.edit.show'
    ], addUi);

    kintone.events.on([
        'app.record.create.submit',
        'app.record.edit.submit'
    ], clearApiKeyBeforeSave);
}());
