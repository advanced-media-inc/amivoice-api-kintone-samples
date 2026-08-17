(function () {
    "use strict";

    var FIELD_CODES = ['apikey', 'api_key'];

    function findApiKeyFieldElement() {
        var fieldElement = null;
        FIELD_CODES.some(function (fieldCode) {
            fieldElement = kintone.app.record.getFieldElement(fieldCode);
            return !!fieldElement;
        });
        return fieldElement;
    }

    function findApiKeyInput() {
        var fieldElement = findApiKeyFieldElement();
        var input = fieldElement && fieldElement.querySelector('.input-text-cybozu');
        if (input) return input;

        for (var i = 0; i < FIELD_CODES.length; i += 1) {
            input = document.querySelector('input[name="' + FIELD_CODES[i] + '"].input-text-cybozu');
            if (input) return input;
        }

        return document.querySelector('.input-text-cybozu');
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
        if (targetElement) {
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
        var input = findApiKeyInput();
        if (input) {
            input.type = 'password';
            input.setAttribute('autocomplete', 'new-password');
            input.value = '';
            addToggleButton(input);
        }
        return event;
    });
})();