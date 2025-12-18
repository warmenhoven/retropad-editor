//Default screen dimensions (16:9 - compatible with built-in overlays) 
const DEF_WIDTH = 800;
const DEF_HEIGHT = 450;
const DEF_SCR_WIDTH = 600;
const DEF_SCR_HEIGHT = 450;

const defaultParamsForNewOverlay = 'full_screen = true\nnormalized = true\nrange_mod = 1.5\nalpha_mod = 2.0';
const autoScaleParams = 'auto_x_separation = true\n'; //auto_y_separation = ?
const manualScaleParams = 'block_x_separation = false\nblock_y_separation = false';

let importedFilename = 'retropad.cfg';
let currentRect;

let screen = {
	_width: DEF_WIDTH,
	_height: DEF_HEIGHT,

	isSetByUser: false,
	isPortrait: false,

	scale: 1,

	get longSide() { return Math.max(this._height, this._width) },
	get shortSide() { return Math.min(this._height, this._width) },

	set width(value) { this._width = Number(value || screen._width || DEF_WIDTH) },
	get enteredWidth() { return this.isPortrait ? this.shortSide : this.longSide },
	get width() { return this.enteredWidth * this.scale },

	set height(value) { this._height = Number(value || screen._height || DEF_HEIGHT) },
	get enteredHeight() { return this.isPortrait ? this.longSide : this.shortSide },
	get height() { return this.enteredHeight * this.scale },

	shotFrameWidth: DEF_SCR_WIDTH,
	shotFrameHeight: DEF_SCR_HEIGHT,

	shotImage: null,
	// screenshot image dimensions
	shotWidth: 0,
	shotHeight: 0,

	shotShow: true,
	shotMode: 'fit', // fit, set, match
}

let images = {};
if (defaultImagesObj) // defaults.js
	images = defaultImagesObj;

let userImages = [];

// Undo/Redo Manager
const undoManager = {
	history: [],
	future: [],
	maxSize: 50,

	pushState(description) {
		this.history.push({
			state: conf.getConfigString(),
			overlay: conf.getCurrentOverlay(),
			desc: description || 'Edit'
		});
		if (this.history.length > this.maxSize) this.history.shift();
		this.future = [];
		this.updateButtons();
	},

	undo() {
		if (this.history.length === 0) return;
		this.future.push({
			state: conf.getConfigString(),
			overlay: conf.getCurrentOverlay(),
			desc: 'Redo point'
		});
		const snapshot = this.history.pop();
		this.restoreState(snapshot);
		this.updateButtons();
	},

	redo() {
		if (this.future.length === 0) return;
		this.history.push({
			state: conf.getConfigString(),
			overlay: conf.getCurrentOverlay(),
			desc: 'Undo point'
		});
		const snapshot = this.future.pop();
		this.restoreState(snapshot);
		this.updateButtons();
	},

	restoreState(snapshot) {
		conf.convertCfgToArray(snapshot.state, () => {
			buildAndSetOverlaySelectors(snapshot.overlay);
			setScreenDimensions();
			redrawPad();
		}, images);
	},

	updateButtons() {
		const undoBtn = document.getElementById('undo-btn');
		const redoBtn = document.getElementById('redo-btn');
		if (undoBtn) undoBtn.disabled = this.history.length === 0;
		if (redoBtn) redoBtn.disabled = this.future.length === 0;
	},

	clear() {
		this.history = [];
		this.future = [];
		this.updateButtons();
	}
};

// Grid settings
let gridSettings = {
	enabled: false,
	snap: false,
	size: 0.02
};

// Preview mode
let previewMode = false;

// Drag state
let dragState = {
	isDragging: false,
	isResizing: false,
	resizeHandle: null,
	startX: 0,
	startY: 0,
	startRectX: 0,
	startRectY: 0,
	startRectW: 0,
	startRectH: 0,
	hasMoved: false,
	undoPushed: false,
	element: null,
	lineIndex: -1,
	// For group dragging
	groupStartPositions: []  // [{lineIndex, x, y}]
};

fillCommandSelector(buttonCommandList);
fillImageSelector();
fillTemplateSelector();

let conf = new ConfigHandler();
let configStr = defaultConfigString; // defaults.js
renderConfig(configStr);

// Track slider drag state for undo
let sliderDragActive = false;
let sliderUndoPushed = false;

// Validate and clamp input values to reasonable ranges
function validateInputValue(elem, value) {
	// Handle NaN
	if (isNaN(value)) return 0;

	// x, y: allow off-screen but cap at reasonable range
	if (elem === 'x' || elem === 'y') {
		return Math.max(-0.5, Math.min(1.5, value));
	}
	// w, h: must be positive, cap at half screen
	if (elem === 'w' || elem === 'h') {
		return Math.max(0.001, Math.min(0.5, value));
	}
	return value;
}

'xywh'.split('').forEach(elem => {
	let range = document.getElementById(elem + '-range');
	let text = document.getElementById(elem + '-number');

	// Mark slider as active on interaction start
	range.addEventListener('mousedown', () => {
		sliderDragActive = true;
		sliderUndoPushed = false;
	});

	range.addEventListener('mouseup', () => {
		sliderDragActive = false;
	});

	// Touch support for sliders
	range.addEventListener('touchstart', () => {
		sliderDragActive = true;
		sliderUndoPushed = false;
	}, { passive: true });

	range.addEventListener('touchend', () => {
		sliderDragActive = false;
	}, { passive: true });

	range.addEventListener('input', (e) => {
		// Push undo state on first value change, not on initial touch/click
		if (sliderDragActive && !sliderUndoPushed) {
			undoManager.pushState('Adjust ' + elem.toUpperCase());
			sliderUndoPushed = true;
		}
		let value = validateInputValue(elem, Number(e.target.value));
		// Snap x/y if enabled
		if ((elem === 'x' || elem === 'y') && gridSettings.snap) {
			value = snapToGrid(value);
		}
		range.value = value;
		applyButtonParam(elem, value);
		text.value = value;
	});

	// Track number input state for undo
	let numberUndoPushed = false;

	text.addEventListener('focus', () => {
		numberUndoPushed = false;
	});

	text.addEventListener('blur', () => {
		numberUndoPushed = false;
	});

	text.addEventListener('input', (e) => {
		// Push undo state on first value change
		if (!numberUndoPushed) {
			undoManager.pushState('Adjust ' + elem.toUpperCase());
			numberUndoPushed = true;
		}
		let value = validateInputValue(elem, Number(e.target.value));
		// Snap x/y if enabled
		if ((elem === 'x' || elem === 'y') && gridSettings.snap) {
			value = snapToGrid(value);
		}
		text.value = value;
		applyButtonParam(elem, value);
		range.value = value;
	});
});

document.getElementById('chk-show-shapes').addEventListener('change', toggleShapes);
document.getElementById('chk-show-names').addEventListener('change', toggleNames);
document.getElementById('chk-show-portrait').addEventListener('change', toggleOrientation);
document.getElementById('chk-show-offscreen').addEventListener('change', toggleOffscreen);
document.getElementById('overlay-selector').addEventListener('change', selectOverlay);

document.getElementById('command-select').addEventListener('change', fillCommandField);
document.getElementById('image-select').addEventListener('change', fillImageNameField);
document.getElementById('image-name').addEventListener('input', e => showImagePreview(e.target.value));

document.getElementById('load-config').addEventListener('change', loadConfigFromFile);
document.getElementById('load-button-images').addEventListener('change', loadImageFiles);
document.getElementById('load-screenshot').addEventListener('change', loadScreenshotFile);
document.getElementById('chk-show-screenshot').addEventListener('change', toggleScreenshot);


function applyButtonParam(section, sValue) {
	let value = Number(sValue);

	// Apply snap to x/y if enabled
	if ((section === 'x' || section === 'y') && gridSettings.snap) {
		value = snapToGrid(value);
	}

	if (conf.isGroupSelected()) {
		conf.setSelectionSectionValue(section, value);
		syncSelectedButtons();
	} else {
		updateCurrentLine(section, value);
	}
}


function createPadView() {
	let background = createPadBackground();
	let rects = conf.buildPadFromConfig();
	if (!rects)
		return;

	for (let i = 0; i < rects.length; i++) {
		let r = rects[i];
		let b = createRect(background, r.command, r.x, r.y, r.w, r.h, r.pct);

		if (r.img) {
			// Try to resolve image: local images object first, then use getImageDisplayUrl
			const imgUrl = images[r.img] || images[r.img.split('/').pop()] || getImageDisplayUrl(r.img);
			b.style['background-image'] = 'url(' + imgUrl + ')';
		}

		if (r.s == 'radial')
			b.classList.add('radial');

		b.dataset.lineIndex = r.i;
		if (conf.isLineInSelection(r.i))
			b.classList.add('selected');

		// Add drag/resize handlers
		addDragHandlers(b, r.i);

		b.addEventListener('click', (e) => {
			// Don't trigger click if we were dragging
			if (dragState.hasMoved) {
				dragState.hasMoved = false;
				return;
			}

			if (currentRect)
				currentRect.classList.remove('selected');

			// Clear any group selection when clicking a single button
			conf.resetGroupSelection();

			conf.setCurrentLine(r.i);
			currentRect = b;

			b.classList.add('selected');

			'xywh'.split('').forEach(elem => {
				let range = document.getElementById(elem + '-range');
				let text = document.getElementById(elem + '-number');
				text.value = conf.getCurrentLineSectionValue(elem);
				range.value = conf.getCurrentLineSectionValue(elem);
			});

			enableEditor(true);
			updateAlignmentToolsVisibility();
			updateSelectedButtonName();
			document.activeElement.blur();
		});
	}
}


// Helper to initialize drag state - shared by mouse and touch handlers
function initDragState(clientX, clientY, target, rectElement, lineIndex) {
	const handle = target.closest('.resize-handle');

	if (handle) {
		dragState.isResizing = true;
		dragState.resizeHandle = handle.dataset.handle;
	} else if (target === rectElement || target.classList.contains('saturate-indicator') || target.nodeType === 3) {
		dragState.isDragging = true;
	} else {
		return false; // Not a valid drag target
	}

	dragState.startX = clientX;
	dragState.startY = clientY;
	dragState.element = rectElement;
	dragState.lineIndex = lineIndex;
	dragState.hasMoved = false;
	dragState.undoPushed = false;

	// Check if this element is part of a group selection
	const isPartOfGroup = conf.isGroupSelected() && conf.isLineInSelection(lineIndex);

	if (isPartOfGroup && dragState.isDragging) {
		// Group drag: capture starting positions of ALL selected elements
		dragState.groupStartPositions = conf.getSelectedIndexes().map(idx => {
			conf.setCurrentLine(idx);
			return {
				lineIndex: idx,
				x: Number(conf.getCurrentLineSectionValue('x')),
				y: Number(conf.getCurrentLineSectionValue('y'))
			};
		});
		// Restore current line to dragged element
		conf.setCurrentLine(lineIndex);
	} else {
		// Single element: clear group, select only this element
		dragState.groupStartPositions = [];
		if (currentRect)
			currentRect.classList.remove('selected');
		deselectAll();
	}

	currentRect = rectElement;
	rectElement.classList.add('selected');

	conf.setCurrentLine(lineIndex);
	enableEditor(true);
	updateEditorSliderValues();
	updateAlignmentToolsVisibility();
	updateSelectedButtonName();

	dragState.startRectX = Number(conf.getCurrentLineSectionValue('x'));
	dragState.startRectY = Number(conf.getCurrentLineSectionValue('y'));
	dragState.startRectW = Number(conf.getCurrentLineSectionValue('w'));
	dragState.startRectH = Number(conf.getCurrentLineSectionValue('h'));

	return true;
}

function addDragHandlers(rectElement, lineIndex) {
	rectElement.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return;

		if (initDragState(e.clientX, e.clientY, e.target, rectElement, lineIndex)) {
			e.stopPropagation();
			e.preventDefault();
		}
	});

	rectElement.addEventListener('touchstart', (e) => {
		if (e.touches.length !== 1) return;

		const touch = e.touches[0];
		if (initDragState(touch.clientX, touch.clientY, e.target, rectElement, lineIndex)) {
			e.preventDefault();
		}
	}, { passive: false });
}


// Global mouse/touch move handler for dragging
document.addEventListener('mousemove', handleDragMove);
document.addEventListener('touchmove', (e) => {
	if (e.touches.length === 1 && (dragState.isDragging || dragState.isResizing)) {
		e.preventDefault();
		handleDragMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
	}
}, { passive: false });

function handleDragMove(e) {
	if (!dragState.isDragging && !dragState.isResizing) return;

	const container = document.querySelector('.screenpad-background');
	if (!container) return;

	const rect = container.getBoundingClientRect();
	const dx = (e.clientX - dragState.startX) / rect.width;
	const dy = (e.clientY - dragState.startY) / rect.height;

	if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
		if (!dragState.hasMoved && !dragState.undoPushed) {
			undoManager.pushState('Move/Resize');
			dragState.undoPushed = true;
		}
		dragState.hasMoved = true;
	}

	if (dragState.isDragging) {
		if (dragState.groupStartPositions.length > 0) {
			// Group drag: update ALL selected elements
			dragState.groupStartPositions.forEach(item => {
				const newX = snapToGrid(item.x + dx);
				const newY = snapToGrid(item.y + dy);
				conf.setCurrentLine(item.lineIndex);
				conf.setCurrentLineSectionValue('x', newX.toFixed(10));
				conf.setCurrentLineSectionValue('y', newY.toFixed(10));
				updateRectVisual(item.lineIndex);
			});
			// Restore current line and update the dragged element's sliders
			conf.setCurrentLine(dragState.lineIndex);
			updateEditorSliderValues();
		} else {
			// Single element drag
			conf.setCurrentLine(dragState.lineIndex);
			let newX = snapToGrid(dragState.startRectX + dx);
			let newY = snapToGrid(dragState.startRectY + dy);
			conf.setCurrentLineSectionValue('x', newX.toFixed(10));
			conf.setCurrentLineSectionValue('y', newY.toFixed(10));
			updateCurrentLine();
			updateEditorSliderValues();
		}
	} else if (dragState.isResizing) {
		conf.setCurrentLine(dragState.lineIndex);
		handleResize(dragState.resizeHandle, dx, dy);
		updateCurrentLine();
		updateEditorSliderValues();
	}
}

function handleResize(handle, dx, dy) {
	let newX = dragState.startRectX;
	let newY = dragState.startRectY;
	let newW = dragState.startRectW;
	let newH = dragState.startRectH;

	// Resize based on handle position
	if (handle.includes('e')) { newW = dragState.startRectW + dx / 2; }
	if (handle.includes('w')) { newW = dragState.startRectW - dx / 2; newX = dragState.startRectX + dx / 2; }
	if (handle.includes('s')) { newH = dragState.startRectH + dy / 2; }
	if (handle.includes('n')) { newH = dragState.startRectH - dy / 2; newY = dragState.startRectY + dy / 2; }

	// Enforce minimum size
	newW = Math.max(0.005, newW);
	newH = Math.max(0.005, newH);

	// Apply snapping
	newX = snapToGrid(newX);
	newY = snapToGrid(newY);
	newW = snapToGrid(newW);
	newH = snapToGrid(newH);

	conf.setCurrentLineSectionValue('x', newX.toFixed(10));
	conf.setCurrentLineSectionValue('y', newY.toFixed(10));
	conf.setCurrentLineSectionValue('w', newW.toFixed(10));
	conf.setCurrentLineSectionValue('h', newH.toFixed(10));
}

// Global mouse/touch up handler
document.addEventListener('mouseup', handleDragEnd);
document.addEventListener('touchend', handleDragEnd);

function handleDragEnd() {
	dragState.isDragging = false;
	dragState.isResizing = false;
	dragState.element = null;
}


function createPadBackground() {
	let backgroundDiv = document.createElement('DIV');
	backgroundDiv.classList.add('screenpad-background');

	let bg = conf.getCurrentOverlayBackground();
	if (bg.image) {
		// Try to resolve image: local images object first, then filename, then URL
		const imgUrl = images[bg.image] || images[bg.image.split('/').pop()] || getImageDisplayUrl(bg.image);
		backgroundDiv.style['background-image'] = 'url(' + imgUrl + ')';
	}

	if (bg.position) {
		backgroundDiv.style.left = (bg.position.x * 100) + '%';
		backgroundDiv.style.top = (bg.position.y * 100) + '%';
		backgroundDiv.style.width = (bg.position.w * 100) + '%';
		backgroundDiv.style.height = (bg.position.h * 100) + '%';
	}

	let padFrame;
	if (bg.fullscreen)
		padFrame = document.getElementById('screenpad');
	else
		padFrame = document.getElementById('game-screenshot');

	padFrame.appendChild(backgroundDiv);

	let startX = 0;
	let startY = 0;
	let isMouseDown = false;

	let select = document.createElement('DIV');
	select.classList.add('selection-box');
	backgroundDiv.appendChild(select);

	let padContianer = document.getElementById('gamepad-container');
	padContianer.onmouseup = cancelSelection;
	padContianer.onpointerleave = cancelSelection;

	function cancelSelection() {
		select.style.display = 'none';
		isMouseDown = false;

		let indexes = conf.getSelectedIndexes();
		if (indexes.length == 0 && conf.getCurrentLineSectionValue('shape') === null)
			enableEditor(false);

		if (indexes.length == 1) {
			let index = indexes[0];
			conf.resetGroupSelection();
			conf.setCurrentLine(index);
			let elem = document.querySelectorAll('.rect[data-line-index="' + index + '"]')[0];

			setTimeout(() => {
				elem.dispatchEvent(new Event('click'));
			}, 0);
		}
	}

	backgroundDiv.onmousedown = (event) => {
		if (event.button != 0)
			return;

		let bgRect = backgroundDiv.getBoundingClientRect();
		let tx = bgRect.left;
		let ty = bgRect.top;
		startX = event.clientX - tx;
		startY = event.clientY - ty;

		isMouseDown = true;
		deselectAll();
		conf.setCurrentLine(-1);
		currentRect = null;
		event.preventDefault();
	}

	padContianer.onmousemove = (event) => {
		if (event.buttons != 1 || !isMouseDown)
			return;

		select.style.display = 'block';

		let bgRect = backgroundDiv.getBoundingClientRect();
		let tx = bgRect.left;
		let ty = bgRect.top;

		let endX = event.clientX - tx;
		let endY = event.clientY - ty;


		setControls(startX, startY, endX, endY);
	}

	// empty event listener (fix for old FF)
	document.getElementById('editor').ontouchstart = () => { };

	backgroundDiv.ontouchstart = (event) => {
		let touches = event.touches;
		if (touches.length != 2) {
			select.style.display = 'none';
			return;
		}

		select.style.display = 'block';

		let bgRect = backgroundDiv.getBoundingClientRect();
		let tx = bgRect.left;
		let ty = bgRect.top;

		let startX = touches[0].clientX - tx;
		let startY = touches[0].clientY - ty;

		let endX = touches[1].clientX - tx;
		let endY = touches[1].clientY - ty;

		setControls(startX, startY, endX, endY);
	}

	function setControls(sX, sY, eX, eY) {
		let left = Math.min(sX, eX);
		let top = Math.min(sY, eY);
		let right = (backgroundDiv.clientWidth - Math.max(sX, eX));
		let bottom = (backgroundDiv.clientHeight - Math.max(sY, eY));

		select.style.left = left + 'px';
		select.style.top = top + 'px';
		select.style.right = right + 'px';
		select.style.bottom = bottom + 'px';

		getButtonsInRect(left, top, right, bottom, backgroundDiv);
		setEditorControls();
	}

	return backgroundDiv;
}


function getButtonsInRect(left, top, right, bottom, container) {
	let bgRect = container.getBoundingClientRect();
	let cWidth = bgRect.width;
	let cHeight = bgRect.height;

	let rectLeft = left / cWidth;
	let rectTop = top / cHeight;
	let rectRight = (cWidth - right) / cWidth;
	let rectBottom = (cHeight - bottom) / cHeight;

	let indexes = conf.selectButtonsInBounds(rectLeft, rectTop, rectRight, rectBottom);

	let rects = document.querySelectorAll('.rect');
	rects.forEach(e => e.classList.remove('selected'));

	indexes.forEach((e) => {
		let elem = document.querySelectorAll('.rect[data-line-index="' + e + '"]');
		if (elem[0])
			elem[0].classList.add('selected');
	});
}


function syncSelectedButtons() {
	let indexes = conf.getSelectedIndexes();

	indexes.forEach((e) => {
		let elem = document.querySelectorAll('.rect[data-line-index="' + e + '"]');
		if (elem[0]) {
			currentRect = elem[0];
			conf.setCurrentLine(e);
			updateCurrentLine(null);
		} else {
			console.log('wrong selection index', e)
		}
	});
}


function deselectAll() {
	let rects = document.querySelectorAll('.rect');
	rects.forEach(e => e.classList.remove('selected'));
	conf.resetGroupSelection();
}


function setEditorControls() {
	enableEditor(false);
	let size = conf.getSelectionDimensions();
	if (size)
		enableEditorSliders(true);
	else {
		updateSelectedButtonName();
		return;
	}

	'xywh'.split('').forEach(elem => {
		let range = document.getElementById(elem + '-range');
		let text = document.getElementById(elem + '-number');
		text.value = Number(size[elem].toFixed(10));
		range.value = size[elem];
	});

	updateAlignmentToolsVisibility();
	updateSelectedButtonName();
}


function loadConfigFromFile(e) {
	let file = e.target.files[0];
	if (!file)
		return;

	importedFilename = file.name;

	let reader = new FileReader();
	reader.onload = function (ev) {
		configStr = ev.target.result;
		try {
			renderConfig(ev.target.result);
		} catch (err) {
			console.error('Config parsing error:', err);
			alert('Failed to parse config file:\n\n' + err.message + '\n\nCheck the file format and try again.');
		}
	};
	reader.onerror = function () {
		console.error('Failed to read file:', reader.error);
		alert('Failed to read file: ' + (reader.error?.message || 'Unknown error'));
	};
	reader.readAsText(file);
}


function renderConfig(str) {
	conf.convertCfgToArray(str, () => {
		buildAndSetOverlaySelectors(0);

		screen.isPortrait = -1 != conf.getOverlayList()[0].search('portrait');
		document.getElementById('chk-show-portrait').checked = screen.isPortrait;

		setScreenDimensions();
		redrawPad();
	},
		images);
}


function loadImageFiles(e) {
	let imgCounter = 0;
	let loadCounter = 0;
	let failedFiles = [];

	for (let i = 0; i < e.target.files.length; i++) {
		let file = e.target.files[i];

		let ext = e.target.files[i].name.substr(-4).toLowerCase();

		if (!file || (ext != '.png' && ext != '.jpg'))
			continue;

		imgCounter++;
		let name = e.target.files[i].name;
		console.log('Loading image:', name);

		let reader = new FileReader();

		reader.onload = function (ev) {
			images[name] = ev.target.result;

			if (!userImages.includes(name)) {
				userImages.push(name);
			}

			// onload is async function so loop ends BEFORE it's first launch
			if (++loadCounter == imgCounter) {
				if (failedFiles.length > 0) {
					alert('Failed to load some images:\n' + failedFiles.join('\n'));
				}
				redrawPad();
				fillImageSelector();
			}
		};

		reader.onerror = function () {
			console.error('Failed to read image:', name, reader.error);
			failedFiles.push(name);
			if (++loadCounter == imgCounter) {
				if (failedFiles.length > 0) {
					alert('Failed to load some images:\n' + failedFiles.join('\n'));
				}
				redrawPad();
				fillImageSelector();
			}
		};

		reader.readAsDataURL(file);
	}
}


function loadScreenshotFile(e) {
	let file = e.target.files[0];
	if (!file)
		return;

	let name = file.name;
	console.log('Loading screenshot:', name);

	let reader = new FileReader();

	reader.onload = function (ev) {
		screen.shotImage = ev.target.result;
		screen.shotShow = true;
		refreshScreenshot();

		// Get image dimensions
		if (screen.shotImage) {
			let im = document.createElement('IMG');
			im.onload = function () {
				screen.shotWidth = im.naturalWidth;
				screen.shotHeight = im.naturalHeight;
				console.log('Screenshot size:', im.naturalWidth, 'x', im.naturalHeight);

				setScreenDimensions();
				redrawPad();
			};
			im.onerror = function () {
				console.error('Failed to load screenshot image');
				// Still allow using the screenshot, just with default dimensions
				setScreenDimensions();
				redrawPad();
			};
			im.src = screen.shotImage;
		}
	};

	reader.onerror = function () {
		console.error('Failed to read screenshot:', reader.error);
		alert('Failed to read screenshot: ' + (reader.error?.message || 'Unknown error'));
	};

	reader.readAsDataURL(file);
}


function refreshScreenshot() {
	let shot = document.getElementById('game-screenshot');

	let screenCheckbox = document.getElementById('chk-show-screenshot')
	screenCheckbox.checked = screen.shotShow;
	screenCheckbox.disabled = !screen.shotImage;

	if (screen.shotShow && screen.shotImage)
		shot.style['background-image'] = 'url(' + screen.shotImage + ')';
	else
		shot.style['background-image'] = 'none';
}


function createRect(target, name, x, y, w, h, pct) {
	let rect = document.createElement('DIV');
	let text = document.createTextNode(name);
	rect.appendChild(text);
	rect.classList.add('rect');

	if (pct) {
		// visualize thumbstick saturate_pct property
		let inner = document.createElement('DIV');
		inner.className = 'saturate-indicator';
		let perc = Math.round(pct * 70);
		inner.style['background-image'] = 'radial-gradient(transparent, rgba(100,100,200,0.4) ' + perc + '%, transparent ' + (perc + 1) + '%)';
		rect.appendChild(inner);
	}

	// Add resize handles
	const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
	handles.forEach(pos => {
		const handle = document.createElement('div');
		handle.className = `resize-handle resize-handle--${pos}`;
		handle.dataset.handle = pos;
		rect.appendChild(handle);
	});

	let bw = 100 * w * 2;
	let bh = 100 * h * 2;

	let bx = 100 * x - bw / 2;
	let by = 100 * y - bh / 2;

	rect.style.left = bx + '%';
	rect.style.top = by + '%';

	rect.style.width = bw + '%';
	rect.style.height = bh + '%';

	target.appendChild(rect);
	return rect;
}


function redrawPad() {
	resetScreen();
	refreshScreenshot();
	createPadView();
	enableEditor(false);
}


function resetScreen() {
	let s = document.getElementById('screenpad');

	s.style.width = screen.width + 'px';
	s.style.height = screen.height + 'px';

	s.innerHTML = '';

	let d = document.createElement('DIV');
	d.classList.add('inner');
	d.id = 'game-screenshot'

	let shotWidth = screen.shotFrameWidth * screen.scale;
	let shotHeight = screen.shotFrameHeight * screen.scale;

	d.style.width = shotWidth + 'px';
	d.style.height = shotHeight + 'px';

	d.style.left = (screen.width - shotWidth) / 2 + 'px';

	if (screen.isPortrait)
		d.style.top = 0;
	else
		d.style.top = (screen.height - shotHeight) / 2 + 'px';

	s.appendChild(d);
}


function setScreenDimensions(width, height, screenshotWidth, screenshotHeight) {
	screen.width = width;
	screen.height = height;

	let ratio = 16 / 9;
	let aspect = conf.getOverlayAspectRatio();
	if (aspect)
		ratio = aspect.w / aspect.h

	// Reverse ratio if it does not match overlay name or orientation checkbox
	if ((screen.isPortrait && ratio > 1) ||
		(!screen.isPortrait && ratio < 1))
		ratio = 1 / ratio;

	if (!screen.isSetByUser)
		if (screen.isPortrait) {
			screen.width = DEF_HEIGHT;
			screen.height = Math.round(DEF_HEIGHT / ratio);
		} else {
			screen.height = DEF_HEIGHT;
			screen.width = Math.round(DEF_HEIGHT * ratio);
		}

	// Swap sides if height > width
	let ewidth = screen.enteredWidth;
	let eheight = screen.enteredHeight;

	let sw = Number(screenshotWidth || screen.shotFrameWidth || DEF_SCR_WIDTH);
	let sh = Number(screenshotHeight || screen.shotFrameHeight || DEF_SCR_HEIGHT);

	if (screen.shotImage && screen.shotShow) {
		switch (screen.shotMode) {
			case 'match':
				sw = screen.shotWidth;
				sh = screen.shotHeight;
				break;

			case 'fit':
				if (ewidth / eheight > screen.shotWidth / screen.shotHeight) {
					sw = eheight * (screen.shotWidth / screen.shotHeight);
					sh = eheight;
				} else {
					sw = ewidth;
					sh = ewidth / (screen.shotWidth / screen.shotHeight);
				}
		}
	} else if (screen.shotMode == 'fit') {
		if (ewidth / eheight > sw / sh) {
			sw = eheight * (sw / sh);
			sh = eheight;
		} else {
			sh = ewidth / (sw / sh);
			sw = ewidth;
		}
	}

	screen.shotFrameWidth = sw;
	screen.shotFrameHeight = sh;
}


function applyScreenDimensions() {
	let w = document.getElementById('display-width').value;
	let h = document.getElementById('display-height').value;
	let sw = document.getElementById('screenshot-width').value;
	let sh = document.getElementById('screenshot-height').value;

	let fit = document.getElementById('radio-screenshot-fit').checked;
	let match = document.getElementById('radio-screenshot-match').checked;
	let setSize = document.getElementById('radio-screenshot-set').checked;

	screen.isSetByUser = true;
	screen.shotMode = fit ? 'fit' : match ? 'match' : setSize ? 'set' : 'fit';

	hideScreenSizeDialog();

	if (document.getElementById('chk-rescale-to-fit').checked)
		screen.scale = calculateScreenSizeToFit(w, h);
	else
		screen.scale = 1;

	setScreenDimensions(w, h, sw, sh);

	redrawPad();
}


function createDownloadLink() {
	let file = new Blob([conf.getConfigString()], { type: 'text/cfg' });
	let a = document.getElementById('export-link');
	a.href = URL.createObjectURL(file);
	a.download = 'new-' + importedFilename;
}


function updateCurrentLine(section, value) {
	if (conf.getCurrentLineSectionValue('shape') === null)
		return;

	if (section)
		conf.setCurrentLineSectionValue(section, value);

	let rw = 100 * conf.getCurrentLineSectionValue('w') * 2;
	let rh = 100 * conf.getCurrentLineSectionValue('h') * 2;

	let rx = 100 * conf.getCurrentLineSectionValue('x') - rw / 2;
	let ry = 100 * conf.getCurrentLineSectionValue('y') - rh / 2;

	if (currentRect) {
		currentRect.style.height = rh + '%';
		currentRect.style.width = rw + '%';
		currentRect.style.left = rx + '%';
		currentRect.style.top = ry + '%';
	}
}


// Update visual position of a rect element by line index
function updateRectVisual(lineIndex) {
	const rectEl = document.querySelector(`.rect[data-line-index="${lineIndex}"]`);
	if (!rectEl) return;

	conf.setCurrentLine(lineIndex);

	let rw = 100 * conf.getCurrentLineSectionValue('w') * 2;
	let rh = 100 * conf.getCurrentLineSectionValue('h') * 2;
	let rx = 100 * conf.getCurrentLineSectionValue('x') - rw / 2;
	let ry = 100 * conf.getCurrentLineSectionValue('y') - rh / 2;

	rectEl.style.height = rh + '%';
	rectEl.style.width = rw + '%';
	rectEl.style.left = rx + '%';
	rectEl.style.top = ry + '%';
}


function buildAndSetOverlaySelectors(selectIndex) {
	let list = conf.getOverlayList();

	let select = document.getElementById('overlay-selector');
	select.innerHTML = '';

	for (let i = 0; i < list.length; i++) {
		let name = (i + 1) + ' - ' + (list[i] ? list[i] : '[unnamed]');
		let o = document.createElement('OPTION');
		o.appendChild(document.createTextNode(name));
		select.appendChild(o);
	}

	selectIndex = Math.min(selectIndex, list.length - 1);
	select.selectedIndex = selectIndex;
	conf.setCurrentOverlay(selectIndex);
	screen.isPortrait = list[selectIndex].search('portrait') != -1;

	document.getElementById('chk-show-portrait').checked = screen.isPortrait;

	let selectNext = document.getElementById('next_target_property');
	selectNext.innerHTML = '';

	selectNext.appendChild(document.createElement('OPTION'));

	for (let i = 0; i < list.length; i++) {
		if (list[i]) {
			let o = document.createElement('OPTION');
			o.appendChild(document.createTextNode(list[i]));
			selectNext.appendChild(o);
		}
	}
}


function fillButtonEditor(command, shape, image, addLines) {
	document.getElementById('command-name').value = command;
	document.getElementById('button-shape').selectedIndex = shape == 'rect' ? 0 : 1;

	if (image)
		document.getElementById('image-name').value = image;
	else
		document.getElementById('image-name').value = '';

	showImagePreview(image);

	setImageSelectorOption(image);
	setCommandSelectorOption(command);

	fillAdditionalPropsFields(addLines.split('\n'));
}


async function fillImageSelector() {
	let selector = document.getElementById('image-select');
	selector.innerHTML = '<option value="">(loading...)</option>';

	userImages.sort();

	// Start with user-uploaded images
	let listAll = [];
	if (userImages.length > 0)
		listAll = listAll.concat(userImages);

	// Add locally bundled images
	let defImages = [''];
	for (let f in images)
		if (!userImages.includes(f))
			defImages.push(f);

	listAll = listAll.concat(defImages);

	// Try to fetch common-overlays images from GitHub
	try {
		const remoteImages = await fetchGitHubImageList();
		if (remoteImages && remoteImages.length > 0) {
			// Add any images from common-overlays that we don't already have
			for (const img of remoteImages) {
				if (!listAll.includes(img)) {
					listAll.push(img);
				}
			}
		}
	} catch (e) {
		console.warn('Could not fetch common-overlays images:', e);
	}

	// Sort (keeping empty string first)
	const emptyFirst = listAll.filter(x => x === '');
	const rest = listAll.filter(x => x !== '').sort();
	listAll = emptyFirst.concat(rest);

	selector.innerHTML = '';
	for (let name of listAll) {
		let o = document.createElement('OPTION');
		o.appendChild(document.createTextNode(name));
		selector.appendChild(o);
	}
}


function fillTemplateSelector() {
	let selector = document.getElementById('template-selector');
	if (!selector || !overlayTemplates) return;

	for (let name of Object.keys(overlayTemplates)) {
		let o = document.createElement('OPTION');
		o.value = name;
		o.appendChild(document.createTextNode(name));
		selector.appendChild(o);
	}
}


function setImageSelectorOption(value) {
	let s = document.getElementById('image-select');
	s.value = '';

	for (let i = 0; i < s.options.length; i++) {
		if (s.options[i].text == value) {
			s.selectedIndex = i;
			break;
		}
	}
}


function fillCommandSelector(commands) {
	let s = document.getElementById('command-select');

	// Handle categorized object format
	if (typeof commands === 'object' && !Array.isArray(commands)) {
		for (const [category, cmds] of Object.entries(commands)) {
			let optgroup = document.createElement('OPTGROUP');
			optgroup.label = category;
			cmds.forEach((cmd) => {
				let o = document.createElement('OPTION');
				o.appendChild(document.createTextNode(cmd));
				optgroup.appendChild(o);
			});
			s.appendChild(optgroup);
		}
	} else {
		// Legacy flat list support
		if (typeof commands === 'string') {
			commands = commands.split('\n');
		}
		commands.forEach((e) => {
			let o = document.createElement('OPTION');
			o.appendChild(document.createTextNode(e));
			s.appendChild(o);
		});
	}
}


function setCommandSelectorOption(value) {
	let s = document.getElementById('command-select');
	s.selectedIndex = 0;

	for (let i = 0; i < s.options.length; i++) {
		if (s.options[i].text == value) {
			s.selectedIndex = i;
			break;
		}
	}
}


function showAdditionalParametersForCommand(command) {
	let parameters = {
		analog_left: 'movable = true\nrange_mod = 2.0\nsaturate_pct = 0.65',
		get analog_right() { return this.analog_left },

		get overlay_next() {
			let list = conf.getOverlayList();
			let current = conf.getCurrentOverlay();

			if (list.length <= 1)
				return '';

			if (current < list.length - 1)
				return 'next_target = ' + list[current + 1]
			else
				return 'next_target = ' + list[0];
		},

		dpad_area: 'range_mod_exclusive = true',
		abxy_area: 'range_mod_exclusive = true',
	}

	return parameters[command];
}


function enableEditor(enable) {
	enableEditorSliders(enable)
	document.getElementById('show-button-editor').disabled = !enable;
	document.getElementById('del-current-button').disabled = !enable;
	if (!enable) {
		updateSelectedButtonName();
	}
}


function enableEditorSliders(enable) {
	let editor = document.getElementById('editor');
	let inputs = editor.querySelectorAll('input,button');
	inputs.forEach(e => { e.disabled = !enable })
}


function fillAdditionalPropsFields(data) {
	clearAdditionalPropsFields();

	if (!Array.isArray(data) || data.length == 0 || data[0] == '')
		return;

	let others = document.getElementById('raw-button-properties');
	let othData = '';

	data.forEach(e => {
		let earr = e.split('=');
		let prop = earr[0].trim();
		let val = earr[1] ? earr[1].trim() : '';
		let fields = [];

		try {
			fields = document.querySelectorAll('.js-additional-button-property #' + prop + '_property');
		} catch {
			console.log('probably wrong property name', prop);
		}

		switch (fields.length) {
			case 1:
				fields[0].value = val;
				break;

			case 0:
				othData += e + '\n';
				break;

			default:
				console.log('More than one ui element found!');
		}

	});

	others.value = othData.trim();
}


function clearAdditionalPropsFields() {
	let v = document.querySelectorAll('.js-additional-button-property input, .js-additional-button-property select');

	v.forEach(e => e.value = '');
	document.getElementById('raw-button-properties').value = '';
}


function readAdditionalPropsFields() {
	let v = document.querySelectorAll('.js-additional-button-property input, .js-additional-button-property select');
	let result = [];

	v.forEach(e => {
		if (e.value != '') {
			let propName = e.id.substr(0, e.id.search(/_property$/));
			result.push(propName + ' = ' + e.value);
		}
	});

	let raw = document.getElementById('raw-button-properties').value;

	return result.concat(processRawProperties(raw));
}


function processRawProperties(str) {
	let arr = str.trim().split('\n');
	let ret = [];

	arr.forEach(e => {
		let line = e.trim();
		if (line == '')
			return;

		let eqPos = line.indexOf('=');

		if (eqPos <= 0) {
			alert('Invalid property format: "' + line + '"\n\nProperties must be in "name = value" format. This line was skipped.');
			return;
		}

		let prop = line.substr(0, eqPos).trim();
		let value = line.substr(eqPos + 1).trim();

		ret.push(prop + ' = ' + value);
	});

	return ret;
}


function resetButtonDialog() {
	document.getElementById('command-select').value = 'a';
	document.getElementById('image-select').value = 'A.png';

	document.getElementById('command-name').value = 'a';
	document.getElementById('image-name').value = 'A.png';
	showImagePreview('A.png');

	document.getElementById('button-shape').value = 'radial';

	clearAdditionalPropsFields();
}


function showDialog(elementId, isShow) {
	let dialog = document.getElementById(elementId);

	if (!dialog)
		return;

	if (isShow) {
		dialog.classList.remove('hidden');
	} else {
		dialog.classList.add('hidden');
		return;
	}

	let focusCandidates = document.querySelectorAll('#' + elementId + ' .js-dialog__focus');
	if (focusCandidates.length > 0)
		focusCandidates[0].focus();
}


function showImagePreview(imgName) {
	// Try to resolve image: local images object first, then filename, then URL
	let image = images[imgName] || images[imgName?.split('/').pop()] || (imgName ? getImageDisplayUrl(imgName) : null);
	let gradient = 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 80%, #aac 90%)';
	let box = document.getElementById('image-name');

	if (image)
		box.style['background-image'] = 'url(' + image + '), ' + gradient;
	else
		box.style['background-image'] = 'none';
}


function generateOverlayName(isPortrait) {
	let prefix = isPortrait ? 'portrait' : 'landscape';
	let index = conf.getOverlayList().length + 1;

	while (conf.isOverlayNameExist(prefix + '-' + index)) {
		index++;
	}

	document.getElementById('overlay-name').value = prefix + '-' + index;
}


function calculateScreenSizeToFit(width, height) {
	let vw = window.innerWidth;
	let _width = Math.max(width, height);
	let _height = Math.min(width, height);
	let scale;

	if (vw < 600) {
		let coef = 0.85;
		let theight = vw * coef;
		scale = theight / _height;
		console.log('[RESCALE] viewport width ' + vw + 'px - screen height ' + theight + 'px (' + coef + ')');
	} else {
		let coef = vw <= 1280 ? 0.7 : 0.55;
		let twidth = vw * coef;
		scale = twidth / _width;
		console.log('[RESCALE] viewport width ' + vw + 'px - screen width ' + twidth + 'px (' + coef + ')');
	}

	let swidth = +(width * scale).toFixed(2);
	let sheight = +(height * scale).toFixed(2);
	console.log('scale factor ' + scale + ' (from ' + width + 'x' + height + ' to ' + swidth + 'x' + sheight + ')');

	return scale;
}


// Inline event listeners

function resetPad() {
	showDialog('reset-dialog', false);
	renderConfig(configStr);
	undoManager.clear();
}


function toggleShapes(event) {
	let s = document.getElementById('screenpad');

	if (event.target.checked)
		s.classList.add('show-borders');
	else
		s.classList.remove('show-borders');
}


function toggleNames(event) {
	let s = document.getElementById('screenpad');

	if (event.target.checked)
		s.classList.remove('hide-names');
	else
		s.classList.add('hide-names');
}


function flipXcoord() {
	undoManager.pushState('Flip X');
	let x = conf.flipXcoord()
	document.getElementById('x-range').value = x;
	document.getElementById('x-number').value = x;
	updateCurrentLine();
	syncSelectedButtons();
}


function normalizeHeight() {
	undoManager.pushState('Make Square');
	let h = conf.normalizeHeight(screen.width, screen.height)
	document.getElementById('h-range').value = h;
	document.getElementById('h-number').value = h;
	updateCurrentLine();
	syncSelectedButtons();
}


function normalizeWidth() {
	undoManager.pushState('Make Square');
	let w = conf.normalizeWidth(screen.width, screen.height)
	document.getElementById('w-range').value = w;
	document.getElementById('w-number').value = w;
	updateCurrentLine();
	syncSelectedButtons();
}


function fixAspect() {
	undoManager.pushState('Fix Aspect Ratio');
	let iw = document.getElementById('initial-aspect-width').value;
	let ih = document.getElementById('initial-aspect-height').value;

	let ow = document.getElementById('target-display-width').value;
	let oh = document.getElementById('target-display-height').value;

	let mode = document.getElementById('chk-keep-relative').checked;

	conf.fixAspect(iw, ih, ow, oh, screen.isPortrait, mode);

	hideAspectFixer();

	// Do not rescale if aspect ratio has been set instesd of target resolutoin
	if (ow >= 96 && oh >= 64)
		setScreenDimensions(ow, oh);

	deselectAll();
	redrawPad();
}


function getButtonDataFromDialog() {
	let d = {};

	d.command = document.getElementById('command-name').value.trim() || 'null';
	if (d.command.search(/\s/) != -1) {
		d.warn = true;
		alert('Invalid command name: Commands cannot contain spaces.\n\nUse underscores instead (e.g., "load_state" not "load state").');
	}

	d.shape = ['rect', 'radial'][document.getElementById('button-shape').selectedIndex];
	d.image = document.getElementById('image-name').value;

	d.lines = readAdditionalPropsFields();
	console.log(d.lines);

	return d;
}


function addButton() {
	let d = getButtonDataFromDialog();
	if (d.warn)
		return;

	undoManager.pushState('Add Button');
	hideButtonEditor();
	conf.createButton(d.command, d.shape, d.image, d.lines);
	redrawPad();
}


function editButton() {
	let d = getButtonDataFromDialog();
	if (d.warn)
		return;

	undoManager.pushState('Edit Button');
	hideButtonEditor();

	// Handle batch edit mode for multi-selection
	if (conf.isGroupSelected()) {
		const command = document.getElementById('command-name').value.trim();
		const image = document.getElementById('image-name').value;
		const shapeSelect = document.getElementById('button-shape');

		if (command) conf.setSelectionCommand(command);
		if (image) conf.setSelectionImage(image);
		if (shapeSelect.selectedIndex >= 0) {
			conf.setSelectionShape(['rect', 'radial'][shapeSelect.selectedIndex]);
		}
	} else {
		conf.updateCurrentButton(d.command, d.shape, d.image, d.lines);
		conf.setCurrentLine(-1);
	}
	redrawPad();
}


function addOverlay() {
	let name = document.getElementById('overlay-name').value.trim();
	let raw = document.getElementById('raw-overlay-properties').value;
	let props = processRawProperties(raw);

	if (conf.isOverlayNameExist(name)) {
		showDialog('name-exist-dialog', true);
		return;
	}

	if (name == '') {
		showDialog('name-empty-dialog', true);
		return;
	}

	undoManager.pushState('Add Overlay');
	if (document.getElementById('chk-duplicate-overlay').checked)
		conf.duplicateCurrentOverlay(name, props);
	else
		conf.createOverlay(name, props);

	hideOverlayEditor();
	buildAndSetOverlaySelectors(1000);
	setScreenDimensions();
	redrawPad();
}


function editOverlay() {
	let name = document.getElementById('overlay-name').value.trim();
	let raw = document.getElementById('raw-overlay-properties').value;

	if (conf.getCurrentOverlayName() != name && conf.isOverlayNameExist(name)) {
		showDialog('name-exist-dialog', true);
		return;
	}

	if (name == '') {
		showDialog('name-empty-dialog', true);
		return;
	}

	undoManager.pushState('Edit Overlay');
	conf.editCurrentOverlay(name, processRawProperties(raw));

	hideOverlayEditor();
	buildAndSetOverlaySelectors(conf.getCurrentOverlay());
	setScreenDimensions();
	redrawPad();
}


function delCurrentButton() {
	showDialog('button-delete-dialog', false);

	undoManager.pushState('Delete Button');
	if (!conf.deleteCurrentButton())
		alert('No button selected. Click on a button first, then try again.');
	redrawPad();
}


function delCurrentOverlay() {
	showDialog('overlay-delete-dialog', false);

	undoManager.pushState('Delete Overlay');
	conf.deleteCurrentOverlay();
	buildAndSetOverlaySelectors(0);
	setScreenDimensions();
	redrawPad();
}


function showButtonEditor() {
	let values = conf.getCurrentButtonParams();

	fillButtonEditor(values.command, values.shape, values.image, values.addLines.join('\n'));

	document.getElementById('button-create-button').classList.add('hidden');
	document.getElementById('button-edit-button').classList.remove('hidden');
	showDialog('button-create-dialog', true);
}


function showButtonCreator() {
	resetButtonDialog();
	document.getElementById('button-create-button').classList.remove('hidden');
	document.getElementById('button-edit-button').classList.add('hidden');
	showDialog('button-create-dialog', true);
}


function hideButtonEditor() {
	showDialog('button-create-dialog', false);
}


function showOverlayEditor() {
	updateNewOverlayFields();
	showDialog('overlay-create-dialog', true);
}


function hideOverlayEditor() {
	showDialog('overlay-create-dialog', false);
}


function showAspectFixer() {
	let aspect = conf.getOverlayAspectRatio();
	if (aspect) {
		document.getElementById('initial-aspect-width').value = aspect.w;
		document.getElementById('initial-aspect-height').value = aspect.h;
	} else {
		document.getElementById('initial-aspect-width').value = screen.isPortrait ? 9 : 16;
		document.getElementById('initial-aspect-height').value = screen.isPortrait ? 16 : 9;
	}

	let hint = document.getElementById('aspect-hint');
	if (screen.isPortrait)
		hint.classList.remove('hidden');
	else
		hint.classList.add('hidden');

	document.getElementById('target-display-width').value = screen.enteredWidth;
	document.getElementById('target-display-height').value = screen.enteredHeight;
	showDialog('aspect-fixer-dialog', true);
}


function hideAspectFixer() {
	showDialog('aspect-fixer-dialog', false);
}


function showScreenSizeDialog() {
	document.getElementById('display-width').value = screen.longSide;
	document.getElementById('display-height').value = screen.shortSide;

	document.getElementById('screenshot-width').value = screen.shotFrameWidth;
	document.getElementById('screenshot-height').value = screen.shotFrameHeight;

	document.getElementById('radio-screenshot-' + screen.shotMode).checked = true;

	document.getElementById('chk-rescale-to-fit').checked = screen.scale != 1;

	let screenshotMatch = document.getElementById('radio-screenshot-match');
	screenshotMatch.disabled = (!screen.shotImage || !screen.shotShow);

	onScreenshotModeChange();

	showDialog('screen-size-dialog', true);
}


function onScreenshotModeChange() {
	let screenshotWidth = document.getElementById('screenshot-width');
	let screenshotHeight = document.getElementById('screenshot-height');

	let screenshotFit = document.getElementById('radio-screenshot-fit');
	let screenshotMatch = document.getElementById('radio-screenshot-match');

	let disableSizeSet = (screen.shotImage && screen.shotShow) && (screenshotFit.checked || screenshotMatch.checked);
	screenshotWidth.disabled = disableSizeSet;
	screenshotHeight.disabled = disableSizeSet;
}


function hideScreenSizeDialog() {
	showDialog('screen-size-dialog', false);
}


function showFileDialog() {
	document.getElementById('chk-show-screenshot').disabled = !screen.shotImage;
	showDialog('import-export-dialog', true);
}


function hideFileDialog() {
	showDialog('import-export-dialog', false);
}


function fillImageNameField(event) {
	document.getElementById('image-name').value = event.target.value;
	showImagePreview(event.target.value);
}


function fillCommandField(event) {
	let command = event.target.value;

	clearAdditionalPropsFields();

	document.getElementById('command-name').value = command;
	let lines = showAdditionalParametersForCommand(command);
	if (lines) {
		fillAdditionalPropsFields(lines.split('\n'));
		toggleAdditionalButtonProperties(true);
	}
}


function toggleOrientation(event) {
	screen.isPortrait = event.target.checked;
	setScreenDimensions();
	redrawPad();
}


function toggleScreenshot(event) {
	screen.shotShow = event.target.checked;
	setScreenDimensions();
	refreshScreenshot();
	redrawPad();
}


function toggleOffscreen(event) {
	let screenDiv = document.getElementById('screenpad');

	if (event.target.checked) {
		screenDiv.classList.add('show-offscreen');
		screenDiv.classList.remove('hide-offscreen');
	} else {
		screenDiv.classList.remove('show-offscreen');
		screenDiv.classList.add('hide-offscreen');
	}
}


function toggleAdditionalButtonProperties(show) {
	let adds = document.getElementsByClassName('js-additional-button-property');
	let addBtn = document.getElementById('btn-additional-button');

	if (show || adds[0].classList.contains('hidden')) {
		addBtn.classList.add('expanded');
		for (let i = 0; i < adds.length; i++)
			adds[i].classList.remove('hidden');
	} else {
		addBtn.classList.remove('expanded');
		for (let i = 0; i < adds.length; i++)
			adds[i].classList.add('hidden');
	}
}


function toggleAdditionalOverlayProperties(show) {
	let add = document.getElementById('overlay-properties-container');
	let addBtn = document.getElementById('overlay-additional-button');

	if (show || add.classList.contains('hidden')) {
		add.classList.remove('hidden');
		addBtn.classList.add('expanded');
	} else {
		add.classList.add('hidden');
		addBtn.classList.remove('expanded');
	}
}


function toggleScreenshotSettings() {
	let settings = document.getElementById('screenshot-area-settings');
	let expander = document.getElementById('screenshot-settings-expander')

	if (settings.classList.contains('hidden')) {
		settings.classList.remove('hidden');
		expander.classList.add('expanded');
	} else {
		settings.classList.add('hidden');
		expander.classList.remove('expanded');
	}
}


function updateNewOverlayFields() {
	let box = document.getElementById('raw-overlay-properties');
	let duplicateChk = document.getElementById('chk-duplicate-overlay');
	let portraitChk = document.getElementById('chk-portrait-overlay');
	let editChk = document.getElementById('chk-edit-overlay');

	let isDuplicate = duplicateChk.checked;
	let isPortrait = portraitChk.checked;
	let isEdit = editChk.checked;

	if (isEdit)
		toggleAdditionalOverlayProperties(true);

	let aspect = screen.longSide / screen.shortSide;

	let createBtn = document.getElementById('overlay-create-button');
	let editBtn = document.getElementById('overlay-edit-button');
	if (isEdit) {
		editBtn.classList.remove('hidden')
		createBtn.classList.add('hidden');
		duplicateChk.disabled = true;
		duplicateChk.checked = false;
		document.getElementById('overlay-name').value = conf.getCurrentOverlayName();
		_fillCurrentOverlay();
		return;
	} else {
		editBtn.classList.add('hidden')
		createBtn.classList.remove('hidden');
		duplicateChk.disabled = false;
	}

	if (isDuplicate) {
		_fillCurrentOverlay();
	} else {
		portraitChk.disabled = false;
		let ratio = 'aspect_ratio = ' + +(isPortrait ? 1 / aspect : aspect).toFixed(7);
		box.value = defaultParamsForNewOverlay + '\n' + ratio;
		box.value += '\n' + autoScaleParams + 'auto_y_separation = ' + (isPortrait ? 'false' : 'true');
		box.value += '\n' + manualScaleParams;
	}

	generateOverlayName(isPortrait);


	function _fillCurrentOverlay() {
		box.value = conf.getCurrentOverlayParams().join('\n');
		isPortrait = document.getElementById('overlay-selector').value.search('portrait') != -1;
		portraitChk.checked = isPortrait;
		portraitChk.disabled = true;
	}
}


function selectOverlay(event) {
	conf.setCurrentOverlay(event.target.selectedIndex);
	conf.setCurrentLine(-1);

	if (event.target.value.search('portrait') != -1)
		screen.isPortrait = true;

	if (event.target.value.search('landscape') != -1)
		screen.isPortrait = false;

	document.getElementById('chk-show-portrait').checked = screen.isPortrait;

	setScreenDimensions();
	redrawPad();
}


function showColorsDialog() {
	showDialog('colors-dialog', true);
}


function setColorScheme(index) {
	let screenpad = document.getElementById('screenpad');
	screenpad.classList.remove('scheme-1');
	screenpad.classList.remove('scheme-2');

	if (index > 0)
		screenpad.classList.add('scheme-' + index);

	// Update grid color for new scheme
	updateGridOverlay();
}


// ==================== NEW FEATURES ====================

// Keyboard Shortcuts
function initKeyboardShortcuts() {
	document.addEventListener('keydown', (e) => {
		// Skip if typing in input/textarea
		if (e.target.matches('input, textarea, select')) return;

		const ctrlOrMeta = e.ctrlKey || e.metaKey;

		// Undo/Redo
		if (ctrlOrMeta && e.key === 'z' && !e.shiftKey) {
			e.preventDefault();
			undoManager.undo();
			return;
		}
		if (ctrlOrMeta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
			e.preventDefault();
			undoManager.redo();
			return;
		}

		// Delete
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (currentRect || conf.isGroupSelected()) {
				e.preventDefault();
				showDialog('button-delete-dialog', true);
			}
			return;
		}

		// Duplicate
		if (ctrlOrMeta && e.key === 'd') {
			e.preventDefault();
			duplicateSelection();
			return;
		}

		// Select All
		if (ctrlOrMeta && e.key === 'a') {
			e.preventDefault();
			selectAllButtons();
			return;
		}

		// Arrow keys for nudging
		const nudgeAmount = e.shiftKey ? 0.01 : 0.001;
		switch (e.key) {
			case 'ArrowUp':
				e.preventDefault();
				nudgeSelection(0, -nudgeAmount);
				break;
			case 'ArrowDown':
				e.preventDefault();
				nudgeSelection(0, nudgeAmount);
				break;
			case 'ArrowLeft':
				e.preventDefault();
				nudgeSelection(-nudgeAmount, 0);
				break;
			case 'ArrowRight':
				e.preventDefault();
				nudgeSelection(nudgeAmount, 0);
				break;
			case 'Escape':
				if (previewMode) {
					togglePreviewMode();
				} else {
					deselectAll();
					enableEditor(false);
				}
				break;
		}
	});
}

function nudgeSelection(dx, dy) {
	if (!currentRect && !conf.isGroupSelected()) return;

	undoManager.pushState('Nudge');

	if (conf.isGroupSelected()) {
		const indexes = conf.getSelectedIndexes();
		indexes.forEach(i => {
			conf.setCurrentLine(i);
			const x = Number(conf.getCurrentLineSectionValue('x')) + dx;
			const y = Number(conf.getCurrentLineSectionValue('y')) + dy;
			conf.setCurrentLineSectionValue('x', x.toFixed(10));
			conf.setCurrentLineSectionValue('y', y.toFixed(10));
		});
		syncSelectedButtons();
	} else if (currentRect) {
		const x = Number(conf.getCurrentLineSectionValue('x')) + dx;
		const y = Number(conf.getCurrentLineSectionValue('y')) + dy;
		conf.setCurrentLineSectionValue('x', x.toFixed(10));
		conf.setCurrentLineSectionValue('y', y.toFixed(10));
		updateEditorSliderValues();
		updateCurrentLine();
	}
}

function selectAllButtons() {
	conf.selectButtonsInBounds(0, 0, 1, 1);
	const indexes = conf.getSelectedIndexes();

	// Update visual selection
	let rects = document.querySelectorAll('.rect');
	rects.forEach(e => e.classList.remove('selected'));
	indexes.forEach(idx => {
		let elem = document.querySelectorAll('.rect[data-line-index="' + idx + '"]');
		if (elem[0]) elem[0].classList.add('selected');
	});

	setEditorControls();
}

function updateEditorSliderValues() {
	'xywh'.split('').forEach(elem => {
		const val = conf.getCurrentLineSectionValue(elem);
		document.getElementById(elem + '-range').value = val;
		document.getElementById(elem + '-number').value = val;
	});
}

// Button Duplication
function duplicateSelection() {
	if (!currentRect && !conf.isGroupSelected()) return;

	undoManager.pushState('Duplicate');

	if (conf.isGroupSelected()) {
		conf.duplicateSelectedButtons(0.02, 0.02);
	} else if (currentRect) {
		conf.duplicateCurrentButton(0.02, 0.02);
	}

	redrawPad();
}

// Alignment Tools
function alignButtons(alignment) {
	if (!conf.isGroupSelected()) return;
	undoManager.pushState('Align ' + alignment);
	conf.alignSelection(alignment);
	syncSelectedButtons();
	redrawPad();
}

function distributeButtons(axis) {
	if (!conf.isGroupSelected()) return;
	undoManager.pushState('Distribute');
	conf.distributeSelection(axis);
	syncSelectedButtons();
	redrawPad();
}

// Grid and Snap
function toggleGrid() {
	gridSettings.enabled = !gridSettings.enabled;
	document.getElementById('chk-show-grid').checked = gridSettings.enabled;
	const controls = document.getElementById('grid-controls');
	if (controls) {
		controls.classList.toggle('hidden', !gridSettings.enabled);
	}
	updateGridOverlay();
}

function toggleSnap() {
	gridSettings.snap = !gridSettings.snap;
	document.getElementById('chk-snap-grid').checked = gridSettings.snap;
}

function setGridSize(size) {
	gridSettings.size = Number(size) || 0.05;
	updateGridOverlay();
}

function updateGridOverlay() {
	let overlay = document.getElementById('grid-overlay');
	const container = document.querySelector('.screenpad-background');

	if (!container) return;

	if (!overlay) {
		overlay = document.createElement('div');
		overlay.id = 'grid-overlay';
		container.appendChild(overlay);
	}

	if (gridSettings.enabled) {
		overlay.style.display = 'block';
		const pct = gridSettings.size * 100;
		overlay.style.backgroundSize = `${pct}% ${pct}%`;

		// Use brighter grid color on dark color schemes
		const screenpad = document.getElementById('screenpad');
		const isDarkScheme = screenpad && (screenpad.classList.contains('scheme-1') || screenpad.classList.contains('scheme-2'));
		const gridColor = isDarkScheme ? 'rgba(150,180,255,0.5)' : 'rgba(80,80,160,0.4)';

		overlay.style.backgroundImage =
			`linear-gradient(to right, ${gridColor} 1px, transparent 1px),` +
			`linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)`;
	} else {
		overlay.style.display = 'none';
	}
}

function snapToGrid(value) {
	if (!gridSettings.snap) return value;
	return Math.round(value / gridSettings.size) * gridSettings.size;
}

// Preview Mode
function togglePreviewMode() {
	previewMode = !previewMode;
	document.body.classList.toggle('preview-mode', previewMode);

	if (previewMode) {
		previewModeEnteredAt = Date.now();
		screen.scale = 1;
		setScreenDimensions();
		redrawPad();
	} else {
		// Restore grid if it was enabled
		updateGridOverlay();
	}
}

// Exit preview mode on click/tap (for touch devices without keyboard)
let previewModeEnteredAt = 0;

document.addEventListener('click', (e) => {
	if (previewMode && Date.now() - previewModeEnteredAt > 300) {
		togglePreviewMode();
		e.preventDefault();
	}
});

document.addEventListener('touchend', (e) => {
	if (previewMode && e.touches.length === 0 && Date.now() - previewModeEnteredAt > 300) {
		togglePreviewMode();
		e.preventDefault();
	}
}, { passive: false });

// Device Presets
function applyDevicePreset() {
	const preset = document.getElementById('device-preset').value;
	if (!preset) return;

	const [w, h] = preset.split(',');
	document.getElementById('display-width').value = w;
	document.getElementById('display-height').value = h;
}

// Templates
function loadTemplate(name) {
	if (!overlayTemplates || !overlayTemplates[name]) return;

	// Warn if there's unsaved work
	if (undoManager.history.length > 0) {
		if (!confirm('This will replace your current work. Continue?')) return;
	}

	configStr = overlayTemplates[name];
	renderConfig(configStr);
	undoManager.clear();
}

// Update alignment tools visibility based on selection
function updateAlignmentToolsVisibility() {
	const tools = document.getElementById('alignment-tools');
	if (tools) {
		tools.classList.toggle('visible', conf.isGroupSelected());
	}
}

// Update selected button name display
function updateSelectedButtonName() {
	const el = document.getElementById('selected-button-name');
	if (!el) return;

	if (conf.isGroupSelected()) {
		const count = conf.getSelectedIndexes().length;
		el.textContent = `(${count} selected)`;
	} else if (conf.getCurrentLineSectionValue('command')) {
		el.textContent = conf.getCurrentLineSectionValue('command');
	} else {
		el.textContent = '';
	}
}

// Initialize keyboard shortcuts on load
initKeyboardShortcuts();

// ==================== COMMON-OVERLAYS INTEGRATION ====================

const GITHUB_API_BASE = 'https://api.github.com/repos/libretro/common-overlays/contents';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/libretro/common-overlays/master';

// In-memory cache for GitHub data (session only)
let githubCache = {
	directories: {},
	imageList: null
};

// Fetch directory listing from GitHub API
async function fetchGitHubDirectory(path) {
	const cacheKey = path || 'root';
	if (githubCache.directories[cacheKey]) {
		return githubCache.directories[cacheKey];
	}

	try {
		const url = path ? `${GITHUB_API_BASE}/${path}` : GITHUB_API_BASE;
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`GitHub API error: ${response.status}`);
		}

		const data = await response.json();
		const items = data.map(item => ({
			name: item.name,
			path: item.path,
			type: item.type // 'file' or 'dir'
		}));

		githubCache.directories[cacheKey] = items;
		return items;
	} catch (error) {
		console.error('Failed to fetch GitHub directory:', error);
		return null;
	}
}

// Fetch raw file content from GitHub
async function fetchGitHubFile(path) {
	try {
		const url = `${GITHUB_RAW_BASE}/${path}`;
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`Failed to fetch file: ${response.status}`);
		}

		return await response.text();
	} catch (error) {
		console.error('Failed to fetch GitHub file:', error);
		return null;
	}
}

// Fetch list of images from common-overlays/gamepads/flat/img/
async function fetchGitHubImageList() {
	if (githubCache.imageList) {
		return githubCache.imageList;
	}

	try {
		const items = await fetchGitHubDirectory('gamepads/flat/img');
		if (!items) return [];

		githubCache.imageList = items
			.filter(item => item.type === 'file' && /\.(png|jpg)$/i.test(item.name))
			.map(item => item.name);

		return githubCache.imageList;
	} catch (error) {
		console.error('Failed to fetch image list:', error);
		return [];
	}
}

// Get display URL for an image (GitHub or local)
function getImageDisplayUrl(imagePath) {
	if (!imagePath) return '';

	// Extract just the filename
	const filename = imagePath.split('/').pop();

	// If we have a local copy, use it (faster)
	if (images[filename]) {
		return images[filename];
	}

	// If we have a source path from GitHub import, resolve relative to it
	if (window.currentOverlaySourcePath) {
		const sourcePath = window.currentOverlaySourcePath;

		// Handle relative paths like ../flat/img/A.png
		if (imagePath.startsWith('../')) {
			// Go up one directory from sourcePath and append the rest
			const parentPath = sourcePath.substring(0, sourcePath.lastIndexOf('/'));
			const relativePart = imagePath.substring(3); // Remove ../
			return `${GITHUB_RAW_BASE}/${parentPath}/${relativePart}`;
		}

		// Handle paths like img/button.png (relative to overlay location)
		if (imagePath.includes('/')) {
			return `${GITHUB_RAW_BASE}/${sourcePath}/${imagePath}`;
		}

		// Just a filename - try the source path's img folder first
		return `${GITHUB_RAW_BASE}/${sourcePath}/img/${filename}`;
	}

	// Fallback: try flat/img for common images
	if (imagePath.includes('flat/img/') || imagePath.includes('/img/')) {
		return `${GITHUB_RAW_BASE}/gamepads/flat/img/${filename}`;
	}

	// Final fallback to local img folder
	return `img/${filename}`;
}

// Open the GitHub overlay browser dialog
async function openGitHubOverlayBrowser() {
	showDialog('github-overlay-dialog', true);

	const statusEl = document.getElementById('github-browser-status');
	const treeEl = document.getElementById('github-browser-tree');

	statusEl.textContent = 'Loading...';
	statusEl.className = '';
	treeEl.innerHTML = '';

	const items = await fetchGitHubDirectory('gamepads');

	if (!items) {
		statusEl.textContent = 'Failed to load from GitHub. Check your internet connection.';
		statusEl.className = 'github-browser-error';
		return;
	}

	statusEl.textContent = 'Select an overlay to import:';

	// Filter to show only directories (overlay sets)
	const dirs = items.filter(item => item.type === 'dir');
	renderGitHubTree(dirs, treeEl, 'gamepads');
}

// Render directory tree
function renderGitHubTree(items, container, basePath) {
	items.forEach(item => {
		const el = document.createElement('div');

		if (item.type === 'dir') {
			el.className = 'github-tree-folder';
			el.textContent = item.name;
			el.dataset.path = item.path;
			el.dataset.expanded = 'false';

			const childContainer = document.createElement('div');
			childContainer.className = 'github-tree-children hidden';
			el.appendChild(childContainer);

			el.addEventListener('click', async (e) => {
				e.stopPropagation();

				// Toggle folder
				if (el.dataset.expanded === 'true') {
					el.dataset.expanded = 'false';
					el.classList.remove('expanded');
					childContainer.classList.add('hidden');
					return;
				}

				// Expand and load contents
				el.dataset.expanded = 'true';
				el.classList.add('expanded');
				childContainer.classList.remove('hidden');

				if (childContainer.children.length === 0) {
					childContainer.innerHTML = '<div class="github-tree-loading">Loading...</div>';
					const children = await fetchGitHubDirectory(item.path);

					childContainer.innerHTML = '';

					if (children) {
						// Sort: directories first, then files
						const sorted = children.sort((a, b) => {
							if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
							return a.name.localeCompare(b.name);
						});
						renderGitHubTree(sorted, childContainer, item.path);
					} else {
						childContainer.innerHTML = '<div class="github-tree-error">Failed to load</div>';
					}
				}
			});
		} else if (item.type === 'file' && item.name.endsWith('.cfg')) {
			el.className = 'github-tree-file';
			el.textContent = item.name;
			el.dataset.path = item.path;

			el.addEventListener('click', async (e) => {
				e.stopPropagation();
				await importGitHubOverlay(item.path, item.name);
			});
		} else {
			// Skip non-cfg files
			return;
		}

		container.appendChild(el);
	});
}

// Import an overlay from GitHub
async function importGitHubOverlay(path, filename) {
	// Warn if there's unsaved work
	if (undoManager.history.length > 0) {
		if (!confirm('This will replace your current work. Continue?')) return;
	}

	const statusEl = document.getElementById('github-browser-status');
	statusEl.textContent = `Importing ${filename}...`;

	const content = await fetchGitHubFile(path);

	if (!content) {
		statusEl.textContent = 'Failed to fetch overlay file.';
		statusEl.className = 'github-browser-error';
		return;
	}

	closeGitHubDialog();

	// Store the source path for path preservation
	const sourcePath = path.substring(0, path.lastIndexOf('/'));
	importOverlayConfig(content, filename, sourcePath);
}

// Import overlay config (shared by GitHub and local file import)
function importOverlayConfig(configString, filename, sourcePath) {
	undoManager.pushState('Import overlay');

	importedFilename = filename;

	// Store source path for path resolution
	window.currentOverlaySourcePath = sourcePath || '';

	configStr = configString;

	try {
		renderConfig(configString);
		undoManager.clear();
		console.log('Successfully imported:', filename);
	} catch (err) {
		console.error('Config parsing error:', err);
		alert('Failed to parse config file:\n\n' + err.message);
	}
}

// Close GitHub dialog
function closeGitHubDialog() {
	showDialog('github-overlay-dialog', false);
}

// Local file import
function importLocalFile() {
	document.getElementById('local-cfg-input').click();
}

function handleLocalFileImport(input) {
	const file = input.files[0];
	if (!file) return;

	const reader = new FileReader();
	reader.onload = function(e) {
		importOverlayConfig(e.target.result, file.name, '');
	};
	reader.onerror = function() {
		alert('Failed to read file: ' + (reader.error?.message || 'Unknown error'));
	};
	reader.readAsText(file);

	// Reset input so same file can be selected again
	input.value = '';
}