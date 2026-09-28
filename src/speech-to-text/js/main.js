(function () {
    'use strict';
    const PLUGIN_ID = kintone.$PLUGIN_ID;
    const config = kintone.plugin.app.getConfig(PLUGIN_ID);
    const QUEUE_KEY = 'amivoice_stt_queue';
    const AUTO_DONE_KEY = 'amivoice_stt_auto_done';
    const RUNNING_KEY = 'amivoice_stt_running';
    // 同期HTTPインタフェースで送信できる音声データの最大サイズ
    const SYNC_HTTP_MAX_AUDIO_BYTES = 16777215;
    // kintoneの文字列(複数行)の文字数上限。超えるとレコード更新全体が失敗する
    const MULTI_LINE_TEXT_MAX_LENGTH = 65535;
    const TRUNCATED_SUFFIX = '\n...(truncated)';

    function renderStatusBadge(text, bgColor) {
        const container = kintone.app.record.getHeaderMenuSpaceElement &&
            kintone.app.record.getHeaderMenuSpaceElement();
        if (!container) {
            return;
        }

        const old = document.getElementById('amivoice-plugin-status-badge');
        if (old) {
            old.remove();
        }

        const badge = document.createElement('span');
        badge.id = 'amivoice-plugin-status-badge';
        badge.style.display = 'inline-block';
        badge.style.padding = '4px 8px';
        badge.style.margin = '4px 0';
        badge.style.borderRadius = '4px';
        badge.style.color = '#fff';
        badge.style.backgroundColor = bgColor;
        badge.style.fontSize = '12px';
        badge.textContent = text;
        container.appendChild(badge);
    }

    function toFieldValue(record, fieldCode, value) {
        if (!fieldCode || !record[fieldCode]) {
            return value;
        }
        const fieldType = record[fieldCode].type;
        if (fieldType === 'SINGLE_LINE_TEXT') {
            return String(value || '').replace(/\r?\n/g, ' / ').slice(0, 1000);
        }
        if (fieldType === 'MULTI_LINE_TEXT' || fieldType === 'RICH_TEXT') {
            const text = String(value || '');
            if (text.length > MULTI_LINE_TEXT_MAX_LENGTH) {
                return text.slice(0, MULTI_LINE_TEXT_MAX_LENGTH - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX;
            }
            return text;
        }
        return value;
    }

    function normalizeFieldCode(value) {
        return String(value || '').trim();
    }

    // AmiVoiceがヘッダーから形式を判別できるのはWAV/Ogg/MP3/FLAC/WebM(Opus)。ヘッダーなしPCMはcパラメータが必要なため非対応
    function guessMimeType(fileName) {
        const lower = String(fileName || '').toLowerCase();
        if (lower.endsWith('.wav')) return 'audio/wav';
        if (lower.endsWith('.mp3')) return 'audio/mpeg';
        if (lower.endsWith('.flac')) return 'audio/flac';
        if (lower.endsWith('.ogg')) return 'audio/ogg';
        if (lower.endsWith('.webm')) return 'audio/webm';
        return 'application/octet-stream';
    }

    function extractFieldStringValue(field) {
        if (!field) {
            return '';
        }
        if (Array.isArray(field.value)) {
            return String(field.value[0] || '').trim();
        }
        return String(field.value || '').trim();
    }

    // 選択肢の表示名(空白除去・小文字化後)と完全一致した場合だけ接続エンジン名に変換する
    const ENGINE_MAP = {
        '会話汎用': '-a-general',
        '英語汎用': '-a-general-en',
        '医療': '-a-medical',
        'e2e日本語_速度優先': '-a2-ja-general',
        'e2e多言語_速度優先': '-a2-multi-general',
        'e2e日本語_精度優先': '-a2b-ja-general',
        'e2e多言語_精度優先': '-a2b-multi-general',
        '-a-general': '-a-general',
        '-a-general-en': '-a-general-en',
        '-a-medical': '-a-medical',
        '-a2-ja-general': '-a2-ja-general',
        '-a2-multi-general': '-a2-multi-general',
        '-a2b-ja-general': '-a2b-ja-general',
        '-a2b-multi-general': '-a2b-multi-general'
    };

    function mapEngineValue(rawValue) {
        const normalized = String(rawValue || '').replace(/\s+/g, '').toLowerCase();
        return Object.prototype.hasOwnProperty.call(ENGINE_MAP, normalized) ? ENGINE_MAP[normalized] : '';
    }

    function resolveEngineParam(record) {
        // テンプレートのエンジン選択欄はフィールドコードがengine_selectionではないため、なければ選択系フィールドを候補にする
        const candidateCodes = record.engine_selection
            ? ['engine_selection']
            : Object.keys(record).filter(function (fieldCode) {
                const type = record[fieldCode] && record[fieldCode].type;
                return type === 'DROP_DOWN' || type === 'RADIO_BUTTON';
            });

        const unmatchedValues = [];
        for (let i = 0; i < candidateCodes.length; i += 1) {
            const value = extractFieldStringValue(record[candidateCodes[i]]);
            if (!value) {
                continue;
            }
            const engine = mapEngineValue(value);
            if (engine) {
                return engine;
            }
            unmatchedValues.push(value);
        }

        if (unmatchedValues.length > 0) {
            throw new Error('認識エンジンを特定できません。エンジン選択の選択肢が対応表と一致しているか確認してください: ' + unmatchedValues.join(', '));
        }
        return '-a-general';
    }

    async function proxyUploadWithTimeout(url, method, headers, data, timeoutMs) {
        return Promise.race([
            kintone.proxy.upload(url, method, headers, data),
            new Promise(function (_, reject) {
                setTimeout(function () {
                    reject(new Error('AmiVoice upload timeout (' + timeoutMs + 'ms)'));
                }, timeoutMs);
            })
        ]);
    }

    // 同期HTTPは音声(a)を最終パートに置いたマルチパートPOSTのみ対応のため、bodyを手組みする
    function buildMultipartFormData(fields, boundary) {
        const CRLF = '\r\n';
        const blobParts = [];

        fields.forEach(function (field) {
            let header = '--' + boundary + CRLF +
                'Content-Disposition: form-data; name="' + field.name + '"';
            if (field.fileName) {
                // 添付ファイル名の「"」「\」や改行がヘッダーを壊さないよう置換する
                header += '; filename="' + String(field.fileName).replace(/["\\\r\n]/g, '_') + '"';
            }
            header += CRLF;
            if (field.contentType) {
                header += 'Content-Type: ' + field.contentType + CRLF;
            }
            header += CRLF;

            blobParts.push(header);
            blobParts.push(field.value);
            blobParts.push(CRLF);
        });
        blobParts.push('--' + boundary + '--' + CRLF);

        return new Blob(blobParts);
    }

    async function downloadKintoneFileBlob(fileKey, timeoutMs) {
        return new Promise(function (resolve, reject) {
            const xhr = new XMLHttpRequest();
            const url = kintone.api.url('/k/v1/file.json', true) + '?fileKey=' + encodeURIComponent(fileKey);
            xhr.open('GET', url, true);
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.withCredentials = true;
            xhr.responseType = 'blob';
            xhr.timeout = timeoutMs;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response);
                    return;
                }
                reject(new Error('kintone file download failed: HTTP ' + xhr.status + ' ' + xhr.statusText));
            };
            xhr.onerror = function () {
                reject(new Error('kintone file download network error'));
            };
            xhr.ontimeout = function () {
                reject(new Error('kintone file download timeout (' + timeoutMs + 'ms)'));
            };
            xhr.send();
        });
    }

    async function processSpeechToText(appId, recordId) {
        async function safePutRecord(recordBody) {
            if (!recordBody || Object.keys(recordBody).length === 0) {
                return { ok: true };
            }
            try {
                await kintone.api(
                    kintone.api.url('/k/v1/record.json', true),
                    'PUT',
                    {
                        app: appId,
                        id: recordId,
                        record: recordBody
                    }
                );
                return { ok: true };
            } catch (e) {
                console.error('[ERROR] record update failed:', e, recordBody);
                return { ok: false, error: e };
            }
        }

        // catch節でも自動判定後の出力先へ書き込めるよう、tryの外で保持する
        let loadedRecord = null;
        let errorResponseFieldCode = normalizeFieldCode(config.responseFieldCode);
        let errorStatusFieldCode = normalizeFieldCode(config.statusFieldCode);

        try {
            if (!config.amivoiceApiKey) {
                renderStatusBadge('AmiVoice: API key missing', '#d84315');
                return false;
            }

            const recordResponse = await kintone.api(
                kintone.api.url('/k/v1/record.json', true),
                'GET',
                {
                    app: appId,
                    id: recordId
                }
            );
            const record = recordResponse.record;

            const textFieldCodes = Object.keys(record).filter(function (fieldCode) {
                const field = record[fieldCode];
                return field && (field.type === 'MULTI_LINE_TEXT' || field.type === 'SINGLE_LINE_TEXT' || field.type === 'RICH_TEXT');
            });

            function pickByPatterns(patterns, excludeCodes) {
                const excludes = excludeCodes || [];
                return textFieldCodes.find(function (code) {
                    if (excludes.indexOf(code) >= 0) {
                        return false;
                    }
                    return patterns.some(function (pattern) {
                        return pattern.test(code);
                    });
                }) || '';
            }

            const resultFieldCode =
                normalizeFieldCode(config.resultFieldCode) ||
                (record.amivoice_result ? 'amivoice_result' : pickByPatterns([/result/i, /amivoice/i, /stt/i, /text/i]));
            const responseFieldCode =
                normalizeFieldCode(config.responseFieldCode) ||
                (record.post_response ? 'post_response' : pickByPatterns([/response/i, /post/i, /api/i, /log/i], [resultFieldCode]));
            const statusFieldCode =
                normalizeFieldCode(config.statusFieldCode) ||
                (record.status ? 'status' : pickByPatterns([/status/i, /state/i], [resultFieldCode, responseFieldCode]));

            const hasStatusField = !!statusFieldCode;
            const hasResultField = !!resultFieldCode;
            const hasPostResponseField = !!responseFieldCode;
            loadedRecord = record;
            errorResponseFieldCode = responseFieldCode;
            errorStatusFieldCode = statusFieldCode;

            const configuredAudioFieldCode = normalizeFieldCode(config.audioFieldCode) || 'audio_file';
            let usedAudioFieldCode = configuredAudioFieldCode;
            let audioFileField = record && record[configuredAudioFieldCode];
            let audioFile = audioFileField && audioFileField.value;

            if (!audioFile || audioFile.length === 0) {
                const detectedFileFieldCode = Object.keys(record || {}).find(function (fieldCode) {
                    const field = record[fieldCode];
                    return field && field.type === 'FILE' && Array.isArray(field.value) && field.value.length > 0;
                });
                if (detectedFileFieldCode) {
                    usedAudioFieldCode = detectedFileFieldCode;
                    audioFileField = record[detectedFileFieldCode];
                    audioFile = audioFileField.value;
                }
            }

            if (!audioFile || audioFile.length === 0) {
                const fileFieldCodes = Object.keys(record || {}).filter(function (fieldCode) {
                    const field = record[fieldCode];
                    return field && field.type === 'FILE';
                });

                const noAudioUpdate = await safePutRecord(
                    Object.assign(
                        hasStatusField
                            ? {
                                [statusFieldCode]: {
                                    value: 'オーディオファイルが見つかりません'
                                }
                            }
                            : {},
                        hasPostResponseField
                            ? {
                                [responseFieldCode]: {
                                    value:
                                        'Audio file is required\n' +
                                        'configuredAudioFieldCode=' + configuredAudioFieldCode + '\n' +
                                        'detectedFileFields=' + (fileFieldCodes.length > 0 ? fileFieldCodes.join(',') : '(none)')
                                }
                            }
                            : {}
                    )
                );
                if (!noAudioUpdate.ok) {
                    console.error('[AmiVoicePlugin] record update failed:', noAudioUpdate.error);
                }

                renderStatusBadge('AmiVoice: no audio file found', '#d84315');
                return false;
            }

            renderStatusBadge('AmiVoice: processing...', '#1565c0');

            const processingUpdate = await safePutRecord(
                hasStatusField
                    ? {
                        [statusFieldCode]: {
                            value: toFieldValue(record, statusFieldCode, '音声認識 処理中... (' + usedAudioFieldCode + ')')
                        }
                    }
                    : {}
            );
            if (!processingUpdate.ok) {
                console.error('[AmiVoicePlugin] record update failed:', processingUpdate.error);
            }

            const fileKey = audioFile[0].fileKey;
            const fileName = audioFile[0].name;
            const contentType = audioFile[0].contentType || guessMimeType(fileName);
            const fileSize = Number(audioFile[0].size);
            if (fileSize > SYNC_HTTP_MAX_AUDIO_BYTES) {
                throw new Error('音声ファイルが同期HTTPの上限（16,777,215バイト）を超えています: ' + fileSize + 'バイト');
            }

            // 複数パラメータを渡す場合はキー付きで指定する（例: grammarFileNames=-a-general）
            const dParams = ['grammarFileNames=' + resolveEngineParam(record)];
            const profileId = extractFieldStringValue(record.profile_id);
            if (profileId) {
                // スペース等が混じるとdパラメータが壊れるため、仕様上使える文字だけを許可する（__始まりは予約済み）
                if (!/^[A-Za-z0-9_-]+$/.test(profileId) || profileId.indexOf('__') === 0) {
                    throw new Error('profile_idは半角英数字、-、_だけで入力してください（__で始まるIDは使用できません）: ' + profileId);
                }
                // profileIdは先頭に「:」を付けないと、セッション終了時にプロファイルの内容が上書きされてしまう
                dParams.push('profileId=:' + profileId);
            }
            const billingKey = extractFieldStringValue(record.billing_key);
            if (billingKey) {
                // <キー>=<値>の<値>部分のみをURLエンコードする
                dParams.push('extension=' + encodeURIComponent(JSON.stringify({
                    client_info: {
                        billing_key: billingKey
                    }
                })));
            }
            const dParam = dParams.join(' ');
            const endpoint = 'https://acp-api.amivoice.com/v1/recognize';
            const blob = await downloadKintoneFileBlob(fileKey, 60000);

            // 音声(a)は最終パートに置くマルチパートPOSTで送信し、APIキーはURLに含めずヘッダーで送る
            const boundary = 'amivoice-' + Date.now().toString(16) + Math.random().toString(16).slice(2);
            const multipartBody = buildMultipartFormData(
                [
                    { name: 'd', value: dParam },
                    { name: 'a', value: blob, contentType: contentType, fileName: fileName }
                ],
                boundary
            );

            // 送信が固まるケースに備え、タイムアウト付きの送信を使う
            const responseWithTimeout = await proxyUploadWithTimeout(
                endpoint,
                'POST',
                {
                    'Content-Type': 'multipart/form-data; boundary=' + boundary,
                    'Authorization': 'Bearer ' + config.amivoiceApiKey
                },
                {
                    format: 'RAW',
                    value: multipartBody
                },
                60000
            );
            const responseBody = responseWithTimeout[0];
            const statusCode = responseWithTimeout[1];
            if (statusCode < 200 || statusCode >= 300) {
                throw new Error('AmiVoice recognize failed: HTTP ' + statusCode + ' ' + responseBody);
            }

            let result;
            try {
                result = JSON.parse(responseBody);
            } catch (e) {
                throw new Error('AmiVoice recognize failed: invalid response body: ' + responseBody);
            }

            // HTTPステータスが200でも認証エラーや発話なし(o)等はcodeにエラーが入る
            if (result.code) {
                throw new Error('AmiVoice recognize failed: code=' + result.code + ' message=' + result.message);
            }

            const resultText = result.text || '';

            const recordToUpdate = {};
            if (hasStatusField) {
                recordToUpdate[statusFieldCode] = {
                    value: toFieldValue(record, statusFieldCode, '完了')
                };
            }
            if (hasResultField) {
                recordToUpdate[resultFieldCode] = {
                    value: toFieldValue(record, resultFieldCode, resultText)
                };
            }
            if (hasPostResponseField) {
                recordToUpdate[responseFieldCode] = {
                    value: toFieldValue(record, responseFieldCode, 'STATUS: ' + statusCode + '\n\n' + responseBody)
                };
            }

            if (Object.keys(recordToUpdate).length === 0) {
                renderStatusBadge('AmiVoice: output fields not configured', '#d84315');
                return false;
            }

            const finalUpdate = await safePutRecord(recordToUpdate);
            if (!finalUpdate.ok) {
                console.error('[AmiVoicePlugin] record update failed:', finalUpdate.error);
                renderStatusBadge('AmiVoice: record update failed', '#d84315');
                return false;
            }

            renderStatusBadge('AmiVoice: completed', '#2e7d32');
            window.location.reload();
            return true;
        } catch (error) {
            console.error('[AmiVoicePlugin] process failed:', error);
            const message = error && error.message ? error.message : String(error);
            try {
                const errorRecord = {};
                if (errorResponseFieldCode) {
                    errorRecord[errorResponseFieldCode] = {
                        value: toFieldValue(loadedRecord || {}, errorResponseFieldCode, 'ERROR: ' + message)
                    };
                }
                if (errorStatusFieldCode) {
                    errorRecord[errorStatusFieldCode] = {
                        value: 'エラー'
                    };
                }
                await safePutRecord(errorRecord);
            } catch (_) {
                // ignore secondary errors
            }
            renderStatusBadge('AmiVoice: failed', '#d84315');
            return false;
        }
    }

    function hasAnyAttachedFile(record) {
        if (!record) {
            return false;
        }
        return Object.keys(record).some(function (fieldCode) {
            const field = record[fieldCode];
            return field && field.type === 'FILE' && Array.isArray(field.value) && field.value.length > 0;
        });
    }

    function hasRecognitionResult(record) {
        if (!record) {
            return false;
        }
        if (record.amivoice_result && typeof record.amivoice_result.value === 'string' && record.amivoice_result.value.trim() !== '') {
            return true;
        }
        const textFields = Object.keys(record).filter(function (fieldCode) {
            const field = record[fieldCode];
            return field && field.type === 'MULTI_LINE_TEXT';
        });
        return textFields.some(function (fieldCode) {
            const val = record[fieldCode].value;
            return typeof val === 'string' && val.indexOf('STATUS: ') === 0;
        });
    }

    // クライアントエラー(o, -, %等)は再送しても同じ結果になるため、失敗済みのレコードは保存し直すまで自動実行しない
    function hasErrorResult(record) {
        if (!record) {
            return false;
        }
        return Object.keys(record).some(function (fieldCode) {
            const field = record[fieldCode];
            return field &&
                (field.type === 'MULTI_LINE_TEXT' || field.type === 'SINGLE_LINE_TEXT') &&
                typeof field.value === 'string' &&
                field.value.indexOf('ERROR: ') === 0;
        });
    }

    function getAutoDoneMap() {
        try {
            const raw = sessionStorage.getItem(AUTO_DONE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function setAutoDone(appId, recordId) {
        const map = getAutoDoneMap();
        map[String(appId) + ':' + String(recordId)] = Date.now();
        sessionStorage.setItem(AUTO_DONE_KEY, JSON.stringify(map));
    }

    function wasAutoDoneRecently(appId, recordId) {
        const map = getAutoDoneMap();
        const key = String(appId) + ':' + String(recordId);
        const ts = map[key];
        if (!ts) {
            return false;
        }
        return Date.now() - ts < 5 * 60 * 1000;
    }

    function getRunningMap() {
        try {
            const raw = sessionStorage.getItem(RUNNING_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function setRunning(appId, recordId) {
        const map = getRunningMap();
        map[String(appId) + ':' + String(recordId)] = Date.now();
        sessionStorage.setItem(RUNNING_KEY, JSON.stringify(map));
    }

    function clearRunning(appId, recordId) {
        const map = getRunningMap();
        delete map[String(appId) + ':' + String(recordId)];
        sessionStorage.setItem(RUNNING_KEY, JSON.stringify(map));
    }

    function isRunningRecently(appId, recordId) {
        const map = getRunningMap();
        const ts = map[String(appId) + ':' + String(recordId)];
        if (!ts) {
            return false;
        }
        return Date.now() - ts < 3 * 60 * 1000;
    }

    kintone.events.on(
        [
            'app.record.create.show',
            'app.record.edit.show',
            'app.record.detail.show'
        ],
        async function (event) {
            window.__amivoicePluginLoaded = true;
            const hasKey = !!config.amivoiceApiKey;
            const message = hasKey
                ? 'AmiVoice plugin loaded (API key configured)'
                : 'AmiVoice plugin loaded (API key missing)';
            renderStatusBadge(message, hasKey ? '#2e7d32' : '#d84315');

            if (event.type === 'app.record.detail.show') {
                const rawQueue = sessionStorage.getItem(QUEUE_KEY);
                if (rawQueue) {
                    try {
                        const queued = JSON.parse(rawQueue);
                        const appId = kintone.app.getId();
                        const recordId = event.recordId || (event.record && event.record.$id && event.record.$id.value);
                        if (queued.appId === appId && String(queued.recordId) === String(recordId)) {
                            if (isRunningRecently(appId, recordId)) {
                                renderStatusBadge('AmiVoice: already running...', '#ef6c00');
                                return event;
                            }
                            sessionStorage.removeItem(QUEUE_KEY);
                            setRunning(appId, recordId);
                            try {
                                const ok = await processSpeechToText(appId, recordId);
                                if (ok) {
                                    setAutoDone(appId, recordId);
                                }
                            } finally {
                                clearRunning(appId, recordId);
                            }
                        }
                    } catch (e) {
                        console.error('[AmiVoicePlugin] queue parse error:', e);
                        sessionStorage.removeItem(QUEUE_KEY);
                    }
                } else {
                    const appId = kintone.app.getId();
                    const recordId = event.recordId || (event.record && event.record.$id && event.record.$id.value);
                    const record = event.record;
                    if (
                        recordId &&
                        hasAnyAttachedFile(record) &&
                        !hasRecognitionResult(record) &&
                        !hasErrorResult(record) &&
                        !wasAutoDoneRecently(appId, recordId) &&
                        !isRunningRecently(appId, recordId)
                    ) {
                        setRunning(appId, recordId);
                        try {
                            const ok = await processSpeechToText(appId, recordId);
                            if (ok) {
                                setAutoDone(appId, recordId);
                            }
                        } finally {
                            clearRunning(appId, recordId);
                        }
                    }
                }
            }

            return event;
        }
    );

    kintone.events.on(
        [
            'app.record.create.submit.success',
            'app.record.edit.submit.success'
        ],
        function (event) {
            const appId = kintone.app.getId();
            const recordId = event.recordId || (event.record && event.record.$id && event.record.$id.value);

            if (!config.amivoiceApiKey) {
                renderStatusBadge('AmiVoice: API key missing', '#d84315');
                return event;
            }

            if (!recordId) {
                console.error('[AmiVoicePlugin] Record ID is missing on submit.success event');
                return event;
            }

            sessionStorage.setItem(
                QUEUE_KEY,
                JSON.stringify({
                    appId: appId,
                    recordId: String(recordId),
                    queuedAt: Date.now()
                })
            );
            return event;
        }
    );
})();