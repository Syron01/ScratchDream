// The toolbar popup writes its switches into chrome.storage.local. The paint editor code runs in
// the page's own world (it needs the page's paper/store objects) and cannot read extension storage,
// so this tiny isolated script forwards only that one flag set. Nothing else crosses the boundary.
(function () {
    'use strict';

    var SOURCE = 'adox-bridge';

    function post(message) {
        try {
            window.postMessage(message, window.location.origin);
        } catch (error) {
            /* a page with an opaque origin simply gets the defaults */
        }
    }

    function push() {
        try {
            chrome.storage.local.get('features', function (saved) {
                post({source: SOURCE, type: 'features', flags: (saved && saved.features) || {}});
            });
        } catch (error) {
            /* extension reloaded while the tab was open: features stay on */
        }
    }

    // The page never has to ask for the flags: they are pushed at document_idle and again once the
    // editor has had its chance to mount. If a ping does arrive it is answered, but only from this
    // window and this origin, because anything in the page can post a message here.
    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        if (event.origin !== window.location.origin) return;
        if (event.data && event.data.source === 'adox-bridge-page' && event.data.type === 'ping') push();
    });

    push();
    window.setTimeout(push, 400);
    window.setTimeout(push, 1500);

    try {
        chrome.storage.onChanged.addListener(function (changes, area) {
            if (area === 'local' && changes.features) push();
        });
    } catch (error) {
        /* no listener: a reload still delivers the flags */
    }
})();
