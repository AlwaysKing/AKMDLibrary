#!/usr/bin/env node
/**
 * Patches BlockNote's SideMenuPlugin to support column layout blocks.
 *
 * Changes:
 * 1. J() (posAtCoords wrapper): Skip column_list/column blocks, search 50px to the right
 * 2. Tt() (updateStateFromMousePos helper): If result is inside a column block-group with
 *    column-list-inner grandparent, search from block left edge instead of right edge
 * 3. onMouseMove: Keep side menu visible when mouse moves into column gap area
 *    (editor space between columns that isn't inside a .bn-block-outer)
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
  console.log('  ⚠ Patch 1: J() pattern not found');
}

// --- Patch 2: Tt() - Handle column blocks ---
const TT_ORIGINAL = `function Tt(e, t) {
\tif (!t.dom.firstChild) return;
\tlet n = t.dom.firstChild.getBoundingClientRect(), r = J(t, {
\t\tleft: Math.min(Math.max(n.left + 10, e.x), n.right - 10),
\t\ttop: e.y
\t});
\tif (r) {
\t\tlet br = r.node.getBoundingClientRect();
\t\treturn J(t, {
\t\t\tleft: br.right - 10,
\t\t\ttop: e.y
\t\t}, !1);
\t}
}`;
const TT_PATCHED = `function Tt(e, t) {
\tif (!t.dom.firstChild) return;
\tlet n = t.dom.firstChild.getBoundingClientRect(), r = J(t, {
\t\tleft: Math.min(Math.max(n.left + 10, e.x), n.right - 10),
\t\ttop: e.y
\t});
\tif (r) {
\t\tlet br = r.node.getBoundingClientRect();
\t\tlet ct = r.node.querySelector('[data-content-type]');
\t\tlet type = ct ? ct.getAttribute('data-content-type') : '';
\t\tlet isInColumn = r.node.closest('.bn-block-group');
\t\tif (isInColumn) {
\t\t\tlet parentBlock = isInColumn.closest('.bn-block');
\t\t\tlet parentOuter = parentBlock ? parentBlock.closest('.bn-block-outer') : null;
\t\t\tlet grandParentGroup = parentOuter ? parentOuter.parentElement : null;
\t\t\tlet grandParentBlock = grandParentGroup ? grandParentGroup.closest('.bn-block') : null;
\t\t\tif (grandParentBlock && grandParentBlock.querySelector('.column-list-inner')) {
\t\t\t\treturn J(t, { left: br.left + 10, top: e.y }, !1);
\t\t\t}
\t\t}
\t\treturn J(t, {
\t\t\tleft: br.right - 10,
\t\t\ttop: e.y
\t\t}, !1);
\t}
}`;

if (code.includes(TT_ORIGINAL)) {
  code = code.replace(TT_ORIGINAL, TT_PATCHED);
  patchCount++;
  console.log('  ✓ Patch 2: Tt() - handle column blocks in updateState');
} else if (!code.includes('isInColumn')) {
  console.log('  ⚠ Patch 2: Tt() pattern not found');
}

// --- Patch 3: onMouseMove - Keep menu in column gap ---
const MOUSEMOVE_ORIGINAL = `\tonMouseMove = (e) => {
\t\tif (this.menuFrozen) return;
\t\tif (e && e.target instanceof Element) {
\t\t\tif (e.target.closest('[data-floating-ui-focusable]:has(> .bn-side-menu)]') || e.target.closest('.bn-side-menu')) {
\t\t\t\treturn;
\t\t\t}
\t\t\tif (!this.editor.isWithinEditor(e.target) && this.state?.show && this.state.referencePos) {
\t\t\t\tlet _ref = this.state.referencePos;
\t\t\t\tlet _rb = _ref.right; if (this.hoveredBlock) { let _br = this.hoveredBlock.getBoundingClientRect(); if (_br.width > 0) _rb = Math.max(_rb, _br.right + 50); } if (e.clientX < _rb && e.clientY >= _ref.top - 10 && e.clientY <= _ref.bottom + 10) return;
\t\t\t}
\t\t}`;

const MOUSEMOVE_PATCHED = `\tonMouseMove = (e) => {
\t\tif (this.menuFrozen) return;
\t\tif (e && e.target instanceof Element) {
\t\t\tif (e.target.closest('[data-floating-ui-focusable]:has(> .bn-side-menu)]') || e.target.closest('.bn-side-menu')) {
\t\t\t\treturn;
\t\t\t}
\t\t\tif (!this.editor.isWithinEditor(e.target) && this.state?.show && this.state.referencePos) {
\t\t\t\tlet _ref = this.state.referencePos;
\t\t\t\tlet _rb = _ref.right; if (this.hoveredBlock) { let _br = this.hoveredBlock.getBoundingClientRect(); if (_br.width > 0) _rb = Math.max(_rb, _br.right + 50); } if (e.clientX < _rb && e.clientY >= _ref.top - 10 && e.clientY <= _ref.bottom + 10) return;
\t\t\t}
\t\t\tif (this.state?.show && this.state.referencePos && this.editor.isWithinEditor(e.target) && !e.target.closest('.bn-block-outer')) {
\t\t\t\tlet _ref = this.state.referencePos;
\t\t\t\tlet _rb = _ref.right; if (this.hoveredBlock) { let _br = this.hoveredBlock.getBoundingClientRect(); if (_br.width > 0) _rb = Math.max(_rb, _br.right + 50); }
\t\t\t\tlet _lb = _ref.left; if (this.hoveredBlock) { let _bl = this.hoveredBlock.getBoundingClientRect(); if (_bl.width > 0) _lb = Math.min(_lb, _bl.left - 50); }
\t\t\t\tif (e.clientX > _lb && e.clientX < _rb && e.clientY >= _ref.top - 10 && e.clientY <= _ref.bottom + 10) return;
\t\t\t}
\t\t}`;

if (code.includes(MOUSEMOVE_ORIGINAL)) {
  code = code.replace(MOUSEMOVE_ORIGINAL, MOUSEMOVE_PATCHED);
  patchCount++;
  console.log('  ✓ Patch 3: onMouseMove - keep menu in column gap');
} else if (!code.includes("!e.target.closest('.bn-block-outer')")) {
  console.log('  ⚠ Patch 3: onMouseMove pattern not found');
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
}

// Write back
fs.writeFileSync(filePath, code, 'utf8');
console.log(`✓ BlockNote patches applied: ${patchCount}/4 succeeded`);
