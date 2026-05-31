(function () {
	var input = document.getElementById('file-upload');
	var list = document.getElementById('file-list');
	if (!input || !list) return;

	// Track files and their contents
	var fileData = [];

	input.addEventListener('change', function () {
		updateFileList();
	});

	// Also watch for programmatic changes via MutationObserver on the input
	var observer = new MutationObserver(function () {
		updateFileList();
	});
	observer.observe(input, { attributes: true });

	// Poll for programmatic .files changes (DataTransfer sets)
	var lastFileCount = 0;
	setInterval(function () {
		if (input.files && input.files.length !== lastFileCount) {
			lastFileCount = input.files.length;
			updateFileList();
		}
	}, 300);

	function formatSize(bytes) {
		if (bytes < 1024) return bytes + ' B';
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
	}

	function updateFileList() {
		list.innerHTML = '';
		fileData = [];

		if (!input.files || input.files.length === 0) return;

		for (var i = 0; i < input.files.length; i++) {
			(function (file, index) {
				// Read file content
				var reader = new FileReader();
				reader.onload = function (e) {
					fileData[index] = { name: file.name, content: e.target.result };
				};
				reader.readAsText(file);

				var item = document.createElement('div');
				item.className = 'file-item';
				item.innerHTML =
					'<span class="file-name">' + escapeHtml(file.name) + '</span>' + '<span class="file-size">' + formatSize(file.size) + '</span>';
				item.addEventListener('click', function () {
					showViewer(index, file.name);
				});
				list.appendChild(item);
			})(input.files[i], i);
		}
	}

	function escapeHtml(text) {
		var div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	function showViewer(index, fileName) {
		var data = fileData[index];
		if (!data) return;

		var overlay = document.createElement('div');
		overlay.className = 'json-overlay';

		var content;
		try {
			var parsed = JSON.parse(data.content);
			content = syntaxHighlight(parsed);
		} catch (e) {
			content = escapeHtml(data.content);
		}

		overlay.innerHTML =
			'<div class="json-viewer">' +
			'  <div class="json-viewer-header">' +
			'    <span class="json-viewer-title">' +
			escapeHtml(fileName) +
			'</span>' +
			'    <button class="json-viewer-close">&times;</button>' +
			'  </div>' +
			'  <div class="json-viewer-body"><pre>' +
			content +
			'</pre></div>' +
			'</div>';

		overlay.querySelector('.json-viewer-close').addEventListener('click', function () {
			overlay.remove();
		});
		overlay.addEventListener('click', function (e) {
			if (e.target === overlay) overlay.remove();
		});

		document.body.appendChild(overlay);
	}

	// Syntax-highlighted JSON with compact short arrays (bboxes stay inline)
	function syntaxHighlight(obj) {
		return formatValue(obj, 0);
	}

	function formatValue(val, depth) {
		if (val === null) return '<span class="json-null">null</span>';
		if (typeof val === 'boolean') return '<span class="json-bool">' + val + '</span>';
		if (typeof val === 'number') return '<span class="json-number">' + val + '</span>';
		if (typeof val === 'string') return '<span class="json-string">"' + escapeHtml(val) + '"</span>';

		if (Array.isArray(val)) return formatArray(val, depth);
		if (typeof val === 'object') return formatObject(val, depth);

		return escapeHtml(String(val));
	}

	function indent(depth) {
		var s = '';
		for (var i = 0; i < depth; i++) s += '  ';
		return s;
	}

	// Keep arrays inline if they contain only primitives and are short
	function isCompactArray(arr) {
		if (arr.length > 8) return false;
		for (var i = 0; i < arr.length; i++) {
			if (arr[i] !== null && typeof arr[i] === 'object') return false;
		}
		var est = JSON.stringify(arr).length;
		return est < 80;
	}

	function formatArray(arr, depth) {
		if (arr.length === 0) return '<span class="json-bracket">[]</span>';

		if (isCompactArray(arr)) {
			var parts = [];
			for (var i = 0; i < arr.length; i++) {
				parts.push(formatValue(arr[i], depth + 1));
			}
			return '<span class="json-bracket">[</span>' + parts.join(', ') + '<span class="json-bracket">]</span>';
		}

		var lines = ['<span class="json-bracket">[</span>'];
		for (var i = 0; i < arr.length; i++) {
			var comma = i < arr.length - 1 ? ',' : '';
			lines.push(indent(depth + 1) + formatValue(arr[i], depth + 1) + comma);
		}
		lines.push(indent(depth) + '<span class="json-bracket">]</span>');
		return lines.join('\n');
	}

	function formatObject(obj, depth) {
		var keys = Object.keys(obj);
		if (keys.length === 0) return '<span class="json-bracket">{}</span>';

		var lines = ['<span class="json-bracket">{</span>'];
		for (var i = 0; i < keys.length; i++) {
			var comma = i < keys.length - 1 ? ',' : '';
			lines.push(
				indent(depth + 1) + '<span class="json-key">"' + escapeHtml(keys[i]) + '"</span>: ' + formatValue(obj[keys[i]], depth + 1) + comma
			);
		}
		lines.push(indent(depth) + '<span class="json-bracket">}</span>');
		return lines.join('\n');
	}
})();
