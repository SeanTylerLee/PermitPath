(function () {
    var header = document.querySelector('header');
    var menuToggle = document.getElementById('menuToggle');
    var dropdownMenu = document.getElementById('dropdownMenu');

    function setMenuOpen(open) {
        if (!menuToggle || !dropdownMenu) return;
        dropdownMenu.classList.toggle('active', open);
        menuToggle.classList.toggle('active', open);
        menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    if (menuToggle && dropdownMenu) {
        menuToggle.addEventListener('click', function () {
            setMenuOpen(!dropdownMenu.classList.contains('active'));
        });

        document.addEventListener('click', function (event) {
            if (!dropdownMenu.classList.contains('active')) return;
            if (dropdownMenu.contains(event.target) || menuToggle.contains(event.target)) return;
            setMenuOpen(false);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') setMenuOpen(false);
        });
    }

    if (header) {
        var compact = false;
        window.addEventListener('scroll', function () {
            var y = window.scrollY;
            if (!compact && y > 100) {
                compact = true;
                header.classList.add('header--compact');
            } else if (compact && y < 40) {
                compact = false;
                header.classList.remove('header--compact');
            }
        }, { passive: true });
    }
})();
