// Glossary view toggle (alphabetical <-> by importance <-> by page)
// Uses document$ so it re-runs on every instant-navigation page load, not
// just the initial hard load. The default view comes from
// knotis.glossary.default_view in zensical.toml.
(function () {
  function initGlossaryToggle() {
    var alpha   = document.getElementById('glossary-alpha');
    var imp     = document.getElementById('glossary-importance');
    var mod     = document.getElementById('glossary-module');
    var btnMod  = document.getElementById('glossary-btn-module');
    var btnAlp  = document.getElementById('glossary-btn-alpha');
    var btnImp  = document.getElementById('glossary-btn-importance');
    if (!alpha || !imp || !mod || !btnMod || !btnAlp || !btnImp) return;
    var defaultView = (alpha.getAttribute('data-default-view') || imp.getAttribute('data-default-view') || mod.getAttribute('data-default-view') || 'alphabetical').toLowerCase();
    var byPageView = defaultView === 'by_page' || defaultView === 'module';

    function getHeadingText(heading) {
      var clone = heading.cloneNode(true);
      var headerlink = clone.querySelector('.headerlink');
      if (headerlink) headerlink.remove();
      return clone.textContent.trim();
    }

    function buildTocItem(heading) {
      var item = document.createElement('li');
      item.className = 'md-nav__item';

      var link = document.createElement('a');
      link.className = 'md-nav__link';
      link.href = '#' + heading.id;

      var ellipsis = document.createElement('span');
      ellipsis.className = 'md-ellipsis';
      ellipsis.textContent = getHeadingText(heading);

      link.appendChild(ellipsis);
      item.appendChild(link);
      return item;
    }

    function syncToc(activeContainer) {
      var tocLists = document.querySelectorAll('ul[data-md-component="toc"]');
      var headings = activeContainer.querySelectorAll('h2[id]');

      tocLists.forEach(function (tocList) {
        tocList.innerHTML = '';
        headings.forEach(function (heading) {
          tocList.appendChild(buildTocItem(heading));
        });
      });
    }

    function showView(view) {
      var showByPage = view === 'by_page' || view === 'module';
      alpha.style.display     = view === 'alphabetical' ? '' : 'none';
      imp.style.display       = view === 'importance' ? '' : 'none';
      mod.style.display       = showByPage ? '' : 'none';
      [
        [newBtnMod, showByPage],
        [newBtnAlp, view === 'alphabetical'],
        [newBtnImp, view === 'importance']
      ].forEach(function (pair) {
        pair[0].classList.toggle('glossary-view__button--active', pair[1]);
        pair[0].setAttribute('aria-pressed', pair[1] ? 'true' : 'false');
      });
      syncToc(showByPage ? mod : view === 'importance' ? imp : alpha);
    }

    // Clone nodes to drop any stale event listeners from a previous page visit
    var newBtnMod = btnMod.cloneNode(true);
    var newBtnAlp = btnAlp.cloneNode(true);
    var newBtnImp = btnImp.cloneNode(true);
    btnMod.parentNode.replaceChild(newBtnMod, btnMod);
    btnAlp.parentNode.replaceChild(newBtnAlp, btnAlp);
    btnImp.parentNode.replaceChild(newBtnImp, btnImp);

    newBtnMod.addEventListener('click', function (e) {
      e.preventDefault();
      showView('by_page');
    });

    newBtnAlp.addEventListener('click', function (e) {
      e.preventDefault();
      showView('alphabetical');
    });

    newBtnImp.addEventListener('click', function (e) {
      e.preventDefault();
      showView('importance');
    });

    if (byPageView) {
      showView('by_page');
    } else {
      showView('alphabetical');
    }
  }

  if (typeof document$ !== 'undefined') {
    document$.subscribe(initGlossaryToggle);
  } else {
    document.addEventListener('DOMContentLoaded', initGlossaryToggle);
  }
})();
