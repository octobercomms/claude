/**
 * Shared admin slide-in panels (ADMIN-BUILD AD16).
 *
 * A trigger carries data-oe-slide-open="<panelId>"; the panel is any element
 * with id="<panelId>" and class "oe-slide". Opening adds .is-open to the panel
 * and shows a shared backdrop. Close on the × button, the backdrop, or Escape.
 * A panel can open on load with data-oe-open="1" (e.g. after a validation
 * round-trip). No dependencies.
 */
(function () {
    'use strict';

    function backdrop() {
        var el = document.querySelector('.oe-slide-backdrop');
        if (!el) {
            el = document.createElement('div');
            el.className = 'oe-slide-backdrop';
            document.body.appendChild(el);
            el.addEventListener('click', closeAll);
        }
        return el;
    }

    function open(panel) {
        if (!panel) { return; }
        backdrop().classList.add('is-on');
        panel.classList.add('is-open');
        var focusable = panel.querySelector('input, select, textarea, button');
        if (focusable) { try { focusable.focus(); } catch (e) {} }
    }

    function closeAll() {
        document.querySelectorAll('.oe-slide.is-open').forEach(function (p) { p.classList.remove('is-open'); });
        var bd = document.querySelector('.oe-slide-backdrop');
        if (bd) { bd.classList.remove('is-on'); }
    }

    document.addEventListener('click', function (e) {
        var trigger = e.target.closest ? e.target.closest('[data-oe-slide-open]') : null;
        if (trigger) {
            e.preventDefault();
            open(document.getElementById(trigger.getAttribute('data-oe-slide-open')));
            return;
        }
        if (e.target.closest && e.target.closest('[data-oe-slide-close]')) {
            e.preventDefault();
            closeAll();
        }
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeAll(); }
    });

    document.addEventListener('DOMContentLoaded', function () {
        var auto = document.querySelector('.oe-slide[data-oe-open="1"]');
        if (auto) { open(auto); }
    });
})();
