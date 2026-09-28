(function () {
    "use strict";

    var FIELD_CODES = ['apikey', 'api_key'];
    // フィールドコードでの検索がkintoneの新UI(Reactベース)で効かない場合に、表示ラベルから探すためのフォールバック
    var LABEL_TEXTS = ['APIキー', 'API キー', 'API Key', 'apikey', 'api_key'];

    function findApiKeyFieldElement() {
        var fieldElement = null;
        FIELD_CODES.some(function (fieldCode) {
            fieldElement = kintone.app.record.getFieldElement(fieldCode);
            return !!fieldElement;
        });
        return fieldElement;
    }

    // ラベルのテキストノードを起点に、上の階層をたどって最初に見つかったinput/textareaを返す
    function findInputByLabelText() {
        var candidates = document.querySelectorAll('body *');
        for (var i = 0; i < candidates.length; i += 1) {
            var element = candidates[i];
            if (element.children.length > 0) continue;
            var text = (element.textContent || '').trim();
            if (LABEL_TEXTS.indexOf(text) === -1) continue;

            var container = element;
            for (var depth = 0; depth < 6 && container; depth += 1) {
                var input = container.querySelector && container.querySelector('input, textarea');
                if (input) return input;
                container = container.parentElement;
            }
        }
        return null;
    }

    function findApiKeyInput() {
        var fieldElement = findApiKeyFieldElement();
        var input = fieldElement && fieldElement.querySelector('.input-text-cybozu');
        if (input) return input;

        // 一部フィールド設定ではinput-text-cybozuクラスが付かない場合があるため、要素内のinputを広く探す
        input = fieldElement && fieldElement.querySelector('input');
        if (input) return input;

        for (var i = 0; i < FIELD_CODES.length; i += 1) {
            input = document.querySelector('input[name="' + FIELD_CODES[i] + '"].input-text-cybozu');
            if (input) return input;
            input = document.querySelector('input[name="' + FIELD_CODES[i] + '"]');
            if (input) return input;
        }

        return findInputByLabelText();
    }

    function addToggleButton(input) {
        if (!input || !input.parentNode) return;
        if (input.parentNode.querySelector('.ami-apikey-toggle-button')) return;

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'ami-apikey-toggle-button';
        button.textContent = '表示';
        button.style.marginLeft = '4px';

        button.addEventListener('click', function () {
            var isMasked = input.type === 'password';
            input.type = isMasked ? 'text' : 'password';
            button.textContent = isMasked ? '非表示' : '表示';
        });

        input.insertAdjacentElement('afterend', button);
    }

    kintone.events.on(['app.record.detail.show'], function (event) {
        var targetElement = findApiKeyFieldElement();
        if (targetElement && targetElement.innerText && targetElement.innerText.trim() !== '') {
            targetElement.innerText = targetElement.innerText.replace(/./g, '*');
        }
        return event;
    });

    kintone.events.on(['app.record.create.show'], function (event) {
        FIELD_CODES.forEach(function (fieldCode) {
            if (event.record[fieldCode]) {
                event.record[fieldCode].value = '';
            }
        });
        return event;
    });

    kintone.events.on(['app.record.create.show', 'app.record.edit.show'], function (event) {
        applyPasswordInputAndToggle();
        return event;
    });

    // プラグインの描画完了より先にこのスクリプトが動くと入力欄がまだ無いため、見つかるまで再試行する
    function applyPasswordInputAndToggle(retryCount) {
        var input = findApiKeyInput();
        if (input) {
            input.type = 'password';
            input.setAttribute('autocomplete', 'new-password');
            input.value = '';
            addToggleButton(input);
            return;
        }
        if ((retryCount || 0) < 5) {
            window.setTimeout(function () {
                applyPasswordInputAndToggle((retryCount || 0) + 1);
            }, 100);
        }
    }
})();