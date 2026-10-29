// The cookie banner every page opens with, until it is accepted: the first
// thing a workflow has to deal with, as on many real sites.
(function () {
    var banner = document.getElementById('cookie-banner');
    if (!banner) return;
    if (localStorage.getItem('demo-cookies') === 'ok') banner.hidden = true;
    document.getElementById('accept-cookies').addEventListener('click', function () {
        localStorage.setItem('demo-cookies', 'ok');
        banner.hidden = true;
    });
})();
