/* October Proposals — public portal behaviour: animate the Plan of Work rail on
   scroll, and send first-party engagement events (section views, video plays,
   CTA clicks) back to the server alongside Microsoft Clarity. */
(function () {
	var s = document.currentScript;
	var ajax = s && s.getAttribute('data-ajax');
	var token = s && s.getAttribute('data-token');

	function send(event, section, value) {
		if (!ajax || !token || !navigator.sendBeacon) { return; }
		var fd = new FormData();
		fd.append('action', 'ocp_event');
		fd.append('token', token);
		fd.append('event', event);
		fd.append('section', section || '');
		fd.append('value', value || '');
		try { navigator.sendBeacon(ajax, fd); } catch (e) {}
	}

	// Animate stages + record section views once.
	var seen = {};
	var io = new IntersectionObserver(function (entries) {
		entries.forEach(function (en) {
			if (!en.isIntersecting) { return; }
			if (en.target.classList.contains('ocp-stage')) {
				en.target.classList.add('in');
			}
			var sec = en.target.getAttribute('data-sec');
			if (sec && !seen[sec]) { seen[sec] = 1; send('section_view', sec); }
		});
	}, { threshold: 0.25 });

	document.querySelectorAll('.ocp-stage, .ocp-sec[data-sec]').forEach(function (el) { io.observe(el); });

	// CTA + video intent.
	document.querySelectorAll('.ocp-accept .ocp-btn').forEach(function (b) {
		b.addEventListener('click', function () { send('cta_click', 'next_step', 'accept'); });
	});
	document.querySelectorAll('.ocp-video iframe').forEach(function (f) {
		f.addEventListener('mouseenter', function () { send('video_intent', '', f.src); }, { once: true });
	});
	document.querySelectorAll('[data-ocp-book]').forEach(function (b) {
		b.addEventListener('click', function () { send('book_click', 'next_step', ''); });
	});
})();
