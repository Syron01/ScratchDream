// Scratch's reply box sits under the comment thread, so in a two-person back-and-forth you
// cannot tell which earlier line a reply answers. Quote opens the native reply box and puts a
// short plain-text snippet of that exact comment at the top, which every Scratch user can read
// even without this extension. Two comment systems are served: the React one on project pages
// and the legacy Django markup on profiles, so both are handled here.
(function () {
    'use strict';

    if (!/^\/(projects\/\d+|users\/[^/]+)/.test(location.pathname) || /\/editor\b/.test(location.pathname)) return;

    // legacy profile pages ship no html lang, so the browser locale is the fallback
    var LABEL = /^tr\b/i.test(document.documentElement.lang || navigator.language || '') ?
        'Alıntıla' : 'Quote';
    var MAX = 90;
    var enabled = true;

    // the popup's own switch owns this feature, like every other tile in it
    function setEnabled(on) {
        enabled = on;
        document.documentElement.classList.toggle('sd-quotes-off', !on);
        if (on) scan();
    }

    function bodyOf(comment) {
        return comment.querySelector('.comment-content') || comment.querySelector('.info > .content');
    }

    function replyLinkOf(comment) {
        return comment.querySelector('.comment-reply') || comment.querySelector('a.reply');
    }

    function boxOf(comment) {
        return comment.querySelector('.comment-reply-row textarea') ||
            comment.querySelector('[data-content="reply-form"] textarea');
    }

    function snippetOf(comment) {
        var body = bodyOf(comment);
        var text = (body ? body.textContent : '').replace(/\s+/g, ' ').trim();
        if (text.length > MAX) text = text.slice(0, MAX).replace(/\s+\S*$/, '') + '…';
        return text;
    }

    function fillBox(comment, quote) {
        var tries = 0;
        (function wait() {
            var box = boxOf(comment);
            if (!box) {
                if (tries++ < 120) requestAnimationFrame(wait);
                return;
            }
            if (box.value.indexOf(quote) === 0) return;
            // React owns the project-page textarea, so assignment alone is ignored by its state;
            // the native setter plus an input event is the only way the draft reaches it
            var set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            set.call(box, quote + box.value);
            box.dispatchEvent(new Event('input', {bubbles: true}));
            box.dispatchEvent(new Event('keyup', {bubbles: true}));
            box.focus();
            box.setSelectionRange(quote.length, quote.length);
        })();
    }

    function quote(button) {
        var comment = button.closest('.comment');
        var text = comment && snippetOf(comment);
        if (!text) return;
        var quote = '> "' + text + '"\n\n';
        if (!boxOf(comment)) {
            var reply = replyLinkOf(comment);
            if (!reply) return;
            reply.click();
        }
        fillBox(comment, quote);
    }

    function scan() {
        if (!enabled) return;
        document.querySelectorAll('.comment').forEach(function (comment) {
            if (comment.querySelector('.sd-quote')) return;
            var reply = replyLinkOf(comment);
            if (!reply || reply.closest('[data-content="reply-form"]')) return;
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'sd-quote';
            button.textContent = LABEL;
            reply.insertAdjacentElement('afterend', button);
        });
    }

    var queued = false;
    new MutationObserver(function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
            queued = false;
            scan();
        });
    }).observe(document.documentElement, {childList: true, subtree: true});

    document.addEventListener('click', function (event) {
        var button = event.target.closest && event.target.closest('.sd-quote');
        if (!button) return;
        event.preventDefault();
        quote(button);
    }, true);

    var style = document.createElement('style');
    // the project-page row is space-between: keeping Reply right-aligned next to Quote stops
    // the native row from pushing Reply into the middle when a third item appears
    style.textContent = '.comment-bottom-row .comment-reply{margin-left:auto}' +
        '.sd-quote{background:none;border:0;box-shadow:none;outline:0;padding:0;margin:0 0 0 10px;' +
        'font:inherit;line-height:inherit;color:#855cd6;cursor:pointer}' +
        '.sd-quote:hover{text-decoration:underline}' +
        '.sd-quotes-off .sd-quote{display:none}';
    document.head.appendChild(style);

    try {
        chrome.storage.local.get('features', function (saved) {
            setEnabled(!saved || !saved.features || saved.features.quotes !== false);
        });
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'local' && changes.features) {
                setEnabled(!changes.features.newValue || changes.features.newValue.quotes !== false);
            }
        });
    } catch (error) {
        /* extension reloaded while the tab was open: quotes stay on */
    }

    scan();
})();
