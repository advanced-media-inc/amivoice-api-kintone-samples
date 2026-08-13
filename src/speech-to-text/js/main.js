(function () {
    'use strict';
    const PLUGIN_ID = kintone.$PLUGIN_ID;
    const config = kintone.plugin.app.getConfig(PLUGIN_ID);
    const QUEUE_KEY = 'amivoice_stt_queue';
    const AUTO_DONE_KEY = 'amivoice_stt_auto_done';
    const RUNNING_KEY = 'amivoice_stt_running';

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
        return value;
    }

    function normalizeFieldCode(value) {
        return String(value || '').trim();
    }

    function guessMimeType(fileName) {
        const lower = String(fileName || '').toLowerCase();
        if (lower.endsWith('.wav')) return 'audio/wav';
        if (lower.endsWith('.mp3')) return 'audio/mpeg';
        if (lower.endsWith('.m4a')) return 'audio/mp4';
        if (lower.endsWith('.aac')) return 'audio/aac';
        if (lower.endsWith('.flac')) return 'audio/flac';
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

    function resolveEngineParam(record) {
        const engineMap = {
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
            const engineValue = String(rawValue || '').trim();
            const normalized = engineValue.replace(/\s+/g, '').toLowerCase();

            if (engineMap[engineValue]) {
                return engineMap[engineValue];
            }
            if (engineMap[normalized]) {
                return engineMap[normalized];
            }
            if (normalized.indexOf('医療') >= 0 || normalized.indexOf('medical') >= 0) {
                return '-a-medical';
            }
            if (normalized.indexOf('英語汎用') >= 0 || normalized.indexOf('english') >= 0 || normalized.indexOf('general-en') >= 0) {
                return '-a-general-en';
            }
            if (normalized.indexOf('e2e日本語_精度優先') >= 0 || normalized.indexOf('e2e日本語精度優先') >= 0 || normalized.indexOf('a2b-ja-general') >= 0) {
                return '-a2b-ja-general';
            }
            if (normalized.indexOf('e2e多言語_精度優先') >= 0 || normalized.indexOf('e2e多言語精度優先') >= 0 || normalized.indexOf('a2b-multi-general') >= 0) {
                return '-a2b-multi-general';
            }
            if (normalized.indexOf('e2e日本語_速度優先') >= 0 || normalized.indexOf('e2e日本語速度優先') >= 0 || normalized.indexOf('a2-ja-general') >= 0) {
                return '-a2-ja-general';
            }
            if (normalized.indexOf('e2e多言語_速度優先') >= 0 || normalized.indexOf('e2e多言語速度優先') >= 0 || normalized.indexOf('a2-multi-general') >= 0) {
                return '-a2-multi-general';
            }
            if (normalized.indexOf('会話汎用') >= 0 || normalized.indexOf('general') >= 0) {
                return '-a-general';
            }

            return '';
        }

        const directMatch = mapEngineValue(extractFieldStringValue(record.engine_selection));
        if (directMatch) {
            return directMatch;
        }

        const detectedFieldCode = Object.keys(record || {}).find(function (fieldCode) {
            const field = record[fieldCode];
            if (!field) {
                return false;
            }
            return !!mapEngineValue(extractFieldStringValue(field));
        });

        if (detectedFieldCode) {
            return mapEngineValue(extractFieldStringValue(record[detectedFieldCode]));
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
            const blob = await downloadKintoneFileBlob(fileKey, 60000);
            const dParams = [resolveEngineParam(record)];
            const billingKey = extractFieldStringValue(record.billing_key);
            if (billingKey) {
                dParams.push('extension=' + JSON.stringify({
                    client_info: {
                        billing_key: billingKey
                    }
                }));
            }
            const dParam = dParams.join(' ');
            const endpoint =
                'https://acp-api.amivoice.com/v1/recognize' +
                '?u=' + encodeURIComponent(config.amivoiceApiKey) +
                '&d=' + encodeURIComponent(dParam);

            // 送信が固まるケースに備え、タイムアウト付きの送信を使う
            const responseWithTimeout = await proxyUploadWithTimeout(
                endpoint,
                'POST',
                {
                    'Content-Type': contentType
                },
                {
                    format: 'RAW',
                    value: blob
                },
                60000
            );
            const responseBody = responseWithTimeout[0];
            const statusCode = responseWithTimeout[1];
            if (statusCode < 200 || statusCode >= 300) {
                throw new Error('AmiVoice recognize failed: HTTP ' + statusCode + ' ' + responseBody);
            }

            let resultText = '';
            try {
                const result = JSON.parse(responseBody);
                resultText = result.text || resultText;
            } catch (e) {
                resultText = responseBody;
            }

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
                const responseFieldCode = normalizeFieldCode(config.responseFieldCode);
                if (responseFieldCode) {
                    errorRecord[responseFieldCode] = {
                        value: 'ERROR: ' + message
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
                                } else {
                                    sessionStorage.setItem(
                                        QUEUE_KEY,
                                        JSON.stringify({ appId: appId, recordId: String(recordId), queuedAt: Date.now() })
                                    );
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