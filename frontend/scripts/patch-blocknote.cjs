#!/usr/bin/env node
/**
 * Patches BlockNote's SideMenuPlugin to support column layout blocks.
 *
 * Changes:
 * 1. J() (posAtCoords wrapper): Skip column_list/column blocks, search 50px to the right
 * 2. Tt() (updateStateFromMousePos helper): Resolve the deepest direct content
 *    row at the pointer Y instead of probing from the editor's left edge
 * 3. onMouseMove: Keep the current block target while moving through the
 *    left-side gap between a block and its side menu
 * 4. updateStateFromMousePos: Don't switch side menu target to column_list/column blocks
 *    when mouse is still within the previously hovered block's expanded range
 */

const fs = require('fs');
const filePath = process.argv[2];

if (!filePath || !fs.existsSync(filePath)) {
  console.error('Usage: node patch-blocknote.js <extensions-file>');
  process.exit(1);
}

let code = fs.readFileSync(filePath, 'utf8');
let patchCount = 0;

// --- Patch 1: J() - Skip column_list/column blocks in posAtCoords ---
const J_ORIGINAL = `function J(e, t, n = !0) {
\tlet r = e.root.elementsFromPoint(t.left, t.top);
\tfor (let i of r) if (e.dom.contains(i)) {
\t\tlet b = mt(i, e);
\t\tif (b) {
\t\t\treturn b;
\t\t}
\t}
}`;
const J_PATCHED = `function J(e, t, n = !0) {
\tlet r = e.root.elementsFromPoint(t.left, t.top);
\tfor (let i of r) if (e.dom.contains(i)) {
\t\tlet b = mt(i, e);
\t\tif (b) {
\t\t\tlet ct = b.node.querySelector('[data-content-type]');
\t\t\tlet type = ct ? ct.getAttribute('data-content-type') : '';
\t\t\tif (type === 'column_list' || type === 'column') {
\t\t\t\treturn J(e, { left: t.left + 50, top: t.top }, !1);
\t\t\t}
\t\t}
\t\treturn b;
\t}
}`;

if (code.includes(J_ORIGINAL)) {
  code = code.replace(J_ORIGINAL, J_PATCHED);
  patchCount++;
  console.log('  ✓ Patch 1: J() - skip column_list/column in posAtCoords');
} else if (!code.includes("type === 'column_list' || type === 'column'")) {
  if (code.includes('[data-node-type=columnList]')) {
    patchCount++;
    console.log('  ✓ Patch 1: column_list skip already provided by BlockNote');
  } else {
    console.log('  ⚠ Patch 1: J() pattern not found');
  }
} else {
  patchCount++;
  console.log('  ✓ Patch 1: column_list skip already patched');
}

// --- Patch 2: Tt() - Resolve block from the direct content row at pointer Y ---
const TT_ROW_ORIGINAL = `function Tt(e, t) {
\tif (!t.dom.firstChild) return;
\tlet n = t.dom.firstChild.getBoundingClientRect(), r = J(t, {
\t\tleft: Math.min(Math.max(n.left + 10, e.x), n.right - 10),
\t\ttop: e.y
\t});
\tif (r) return J(t, {
\t\tleft: r.node.getBoundingClientRect().right - 10,
\t\ttop: e.y
\t}, !1);
}`;
const TT_ROW_PATCHED = `function Tt(e, t) {
\tif (!t.dom.firstChild) return;
\tlet rows = [];
\tfor (let outer of t.dom.querySelectorAll('.bn-block-outer')) {
\t\tlet block = outer.querySelector(':scope > .bn-block');
\t\tlet content = block?.querySelector(':scope > .bn-block-content') || block?.querySelector(':scope > .react-renderer > .bn-block-content');
\t\tlet rect = content?.getBoundingClientRect();
\t\tlet type = content?.getAttribute('data-content-type');
\t\tif (!block || !rect || rect.width <= 0 || rect.height <= 0 || type === 'column_list' || type === 'column') continue;
\t\tlet verticalDistance = e.y < rect.top ? rect.top - e.y : e.y > rect.bottom ? e.y - rect.bottom : 0;
\t\tlet depth = 0, parent = outer;
\t\twhile ((parent = parent.parentElement) && t.dom.contains(parent)) if (parent.classList.contains('bn-block-outer')) depth++;
\t\trows.push({
\t\t\tblock,
\t\t\tdepth,
\t\t\tverticalDistance,
\t\t\thorizontalDistance: Math.abs(e.x - (rect.left + rect.width / 2))
\t\t});
\t}
\tlet candidates = rows.filter((row) => row.verticalDistance === 0);
\tif (!candidates.length) candidates = rows.filter((row) => row.verticalDistance <= 12);
\tif (candidates.length) {
\t\tcandidates.sort((a, b) => b.depth - a.depth || a.verticalDistance - b.verticalDistance || a.horizontalDistance - b.horizontalDistance);
\t\tlet block = candidates[0].block;
\t\treturn {
\t\t\tnode: block,
\t\t\tid: block.getAttribute('data-id')
\t\t};
\t}
\tlet n = t.dom.firstChild.getBoundingClientRect(), r = J(t, {
\t\tleft: Math.min(Math.max(n.left + 10, e.x), n.right - 10),
\t\ttop: e.y
\t});
\tif (r) return J(t, {
\t\tleft: r.node.getBoundingClientRect().right - 10,
\t\ttop: e.y
\t}, !1);
}`;

if (code.includes(TT_ROW_PATCHED)) {
  patchCount++;
  console.log('  ✓ Patch 2: Tt() - row hit-testing already applied');
} else if (code.includes(TT_ROW_ORIGINAL)) {
  code = code.replace(TT_ROW_ORIGINAL, TT_ROW_PATCHED);
  patchCount++;
  console.log('  ✓ Patch 2: Tt() - resolve deepest content row at pointer Y');
} else {
  console.log('  ⚠ Patch 2: Tt() row pattern not found');
}

// --- Patch 3: Preserve hovered block across the side-menu bridge ---
// Both mouse movement and document updates after insertion must use the same
// hit area; otherwise a newly inserted short block can steal the handler.
const BRIDGE_HELPER_ANCHOR = 'var Et = class {';
const BRIDGE_HELPER_BODY = `function _isSideMenuBridgePoint(e, t) {
\tif (!e?.isConnected || !t) return !1;
\tlet _sideMenuBridgeContent = e.querySelector(':scope > .bn-block-content') || e.querySelector(':scope > .react-renderer > .bn-block-content');
\tlet n = (_sideMenuBridgeContent || e).getBoundingClientRect();
\treturn t.x >= n.left - 64 && t.x <= n.left + 12 && t.y >= n.top - 12 && t.y <= n.bottom + 12;
}
`;
const BRIDGE_HELPER = `${BRIDGE_HELPER_BODY}var Et = class {`;
const OLD_BRIDGE_HELPER = `function _isSideMenuBridgePoint(e, t) {
\tif (!e?.isConnected || !t) return !1;
\tlet n = e.getBoundingClientRect();
\treturn t.x >= n.left - 64 && t.x <= n.left + 12 && t.y >= n.top - 12 && t.y <= n.bottom + 12;
}
`;
const BRIDGE_GUARD = '\t\tif (this.state?.show && _isSideMenuBridgePoint(this.hoveredBlock, this.mousePos)) return;\n';
const OLD_MOUSEMOVE_BRIDGE = `\t\tif (this.state?.show && this.hoveredBlock) {
\t\t\tlet _hb = this.hoveredBlock.getBoundingClientRect();
\t\t\tif (e.clientX >= _hb.left - 64 && e.clientX <= _hb.left + 12 && e.clientY >= _hb.top - 12 && e.clientY <= _hb.bottom + 12) return;
\t\t}
\t\tthis.updateStateFromMousePos();`;
const MOUSEMOVE_BRIDGE = `${BRIDGE_GUARD}\t\tthis.updateStateFromMousePos();`;
const UPDATE_STATE_START = `\tupdateStateFromMousePos = () => {
\t\tif (this.menuFrozen || !this.mousePos) return;`;
const UPDATE_STATE_WITH_BRIDGE = `${UPDATE_STATE_START}
${BRIDGE_GUARD}`;

let bridgeReady = code.includes('_sideMenuBridgeContent');
if (!bridgeReady && code.includes(OLD_BRIDGE_HELPER)) {
  code = code.replace(OLD_BRIDGE_HELPER, BRIDGE_HELPER_BODY);
  bridgeReady = true;
} else if (!bridgeReady && code.includes(BRIDGE_HELPER_ANCHOR)) {
  code = code.replace(BRIDGE_HELPER_ANCHOR, BRIDGE_HELPER);
  bridgeReady = true;
}

code = code.replace('var Et = class {var Et = class {', 'var Et = class {');

let mouseMoveReady = false;
if (code.includes(OLD_MOUSEMOVE_BRIDGE)) {
  code = code.replace(OLD_MOUSEMOVE_BRIDGE, MOUSEMOVE_BRIDGE);
  mouseMoveReady = true;
} else if (code.includes(MOUSEMOVE_BRIDGE)) {
  mouseMoveReady = true;
} else if (code.includes('\t\tthis.updateStateFromMousePos();\n\t}')) {
  code = code.replace('\t\tthis.updateStateFromMousePos();\n\t}', MOUSEMOVE_BRIDGE + '\n\t}');
  mouseMoveReady = true;
}

let updateStateReady = false;
if (code.includes(UPDATE_STATE_WITH_BRIDGE)) {
  updateStateReady = true;
} else if (code.includes(UPDATE_STATE_START)) {
  code = code.replace(UPDATE_STATE_START, UPDATE_STATE_WITH_BRIDGE);
  updateStateReady = true;
}

if (bridgeReady && mouseMoveReady && updateStateReady) {
  patchCount++;
  console.log('  ✓ Patch 3: preserve target across side-menu bridge');
} else {
  console.log('  ⚠ Patch 3: side-menu bridge pattern not found');
}

// --- Patch 4: updateStateFromMousePos - Don't switch to column blocks ---
// Find the block after "if (!t || !this.editor.isEditable)" section
const UPDATE_ORIGINAL = `\t\tthis.state?.show && (this.state.show = !1, this.updateState(this.state));
\t\t\treturn;
\t\t}
\t\tif (!(this.state?.show && this.hoveredBlock?.hasAttribute("data-id")`;

const UPDATE_PATCHED = `\t\tthis.state?.show && (this.state.show = !1, this.updateState(this.state));
\t\t\treturn;
\t\t}
\t\tif (this.state?.show && this.hoveredBlock) {
\t\t\tlet _ct = t.node.querySelector('[data-content-type]');
\t\t\tlet _type = _ct ? _ct.getAttribute('data-content-type') : '';
\t\t\tif (_type === 'column_list' || _type === 'column') {
\t\t\t\tlet _hb = this.hoveredBlock.getBoundingClientRect();
\t\t\t\tif (this.mousePos.x > _hb.left - 50 && this.mousePos.x < _hb.right + 50 && this.mousePos.y >= _hb.top - 10 && this.mousePos.y <= _hb.bottom + 10) return;
\t\t\t}
\t\t}
\t\tif (!(this.state?.show && this.hoveredBlock?.hasAttribute("data-id")`;

if (code.includes(UPDATE_ORIGINAL)) {
  code = code.replace(UPDATE_ORIGINAL, UPDATE_PATCHED);
  patchCount++;
  console.log('  ✓ Patch 4: updateStateFromMousePos - skip column blocks in range');
} else if (!code.includes("_type === 'column_list' || _type === 'column'")) {
  console.log('  ⚠ Patch 4: updateStateFromMousePos pattern not found');
} else {
  patchCount++;
  console.log('  ✓ Patch 4: column block guard already applied');
}

// Write back
fs.writeFileSync(filePath, code, 'utf8');
console.log(`✓ BlockNote patches ready: ${patchCount}/4`);
