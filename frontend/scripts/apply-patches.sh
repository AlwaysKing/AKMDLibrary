#!/bin/bash
# Apply patches to node_modules after npm install
# Fix: prosemirror-tables updateColumnsOnResize should always set minWidth

PATCH_TARGET="node_modules/prosemirror-tables/dist/index.js"

if [ -f "$PATCH_TARGET" ]; then
  # Fix: always keep the computed total width on the table.
  # Without this, widening one column can steal width from the trailing column
  # instead of growing the table and showing horizontal overflow.
  sed -i.bak 's/\t  table\.style\.width = \"\";/\t  table.style.width = totalWidth + \"px\";/' "$PATCH_TARGET" && \
  sed -i.bak 's/\t  table\.style\.minWidth = \"\";/\t  table.style.minWidth = totalWidth + \"px\";/' "$PATCH_TARGET" && rm -f "${PATCH_TARGET}.bak"
  echo "✓ Patched prosemirror-tables: minWidth fix applied"
else
  echo "⚠ Skipping prosemirror-tables patch: $PATCH_TARGET not found"
fi
