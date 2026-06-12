import { PartialBlock } from '@blocknote/core';

/**
 * Parse markdown and convert to BlockNote blocks
 */
export function markdownToBlocks(markdown: string): PartialBlock[] {
  if (!markdown) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: '', styles: {} }] }];
  }
  const blocks: any[] = [];
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line - skip (paragraph separator in markdown)
    if (!trimmed) {
      i++;
      continue;
    }

    // Zero-width space marker = preserved empty paragraph
    if (trimmed === '​') {
      blocks.push({
        type: 'paragraph',
        content: [{ type: 'text', text: '', styles: {} }],
      });
      i++;
      continue;
    }

    // Toggle blocks: <toggle-h level="N"> ... </toggle-h> or <toggle-list> ... </toggle-list>
    const toggleOpenMatch = trimmed.match(/^<(toggle-h|toggle-list)([^>]*)>$/);
    if (toggleOpenMatch) {
      const tagName = toggleOpenMatch[1];
      const attrs = toggleOpenMatch[2];
      const openTagRegex = new RegExp(`^<${tagName}[^>]*>$`);
      const closeTag = `</${tagName}>`;

      // Collect all inner lines, handling nesting
      const innerLines: string[] = [];
      let depth = 1;
      i++;
      while (i < lines.length && depth > 0) {
        const innerTrimmed = lines[i].trim();
        if (openTagRegex.test(innerTrimmed)) depth++;
        if (innerTrimmed === closeTag) depth--;
        if (depth > 0) innerLines.push(lines[i]);
        i++;
      }

      // Extract <title> and <content> sections
      const titleText = extractTagContent(innerLines, 'title');
      const contentText = extractTagContent(innerLines, 'content');

      // Build block
      if (tagName === 'toggle-h') {
        const levelMatch = attrs.match(/level="(\d+)"/);
        const level = levelMatch ? parseInt(levelMatch[1]) : 1;
        const block: any = {
          type: 'heading',
          props: { level, isToggleable: true },
          content: parseInlineFormatting(titleText),
        };
        if (contentText.trim()) {
          block.children = markdownToBlocks(contentText);
        }
        blocks.push(block);
      } else {
        // toggle-list
        const block: any = {
          type: 'toggleListItem',
          content: parseInlineFormatting(titleText),
        };
        if (contentText.trim()) {
          block.children = markdownToBlocks(contentText);
        }
        blocks.push(block);
      }
      continue;
    }

    // Table block: <table-block> ... </table-block>
    if (trimmed === '<table-block>') {
      const innerLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '</table-block>') {
        innerLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing </table-block>

      const innerContent = innerLines.join('\n').trim();

      // Try JSON format first (for tables with merged cells)
      let tableRows: any[] | null = null;
      let trueColCount = 0;
      let parsedWidths: (number | null)[] | null = null;
      if (innerContent.startsWith('[') || innerContent.startsWith('{')) {
        try {
          const jsonData = JSON.parse(innerContent);
          // New format: { widths: [...], rows: [...] }
          const isObject = !Array.isArray(jsonData) && typeof jsonData === 'object';
          const widths = isObject ? (jsonData as any).widths : null;
          const rowsData = isObject ? (jsonData as any).rows : jsonData;

          if (Array.isArray(rowsData)) {
            if (widths && Array.isArray(widths)) {
              parsedWidths = widths.map((w: any) => (typeof w === 'number' ? w : null));
            }
            tableRows = rowsData.map((row: any) => ({
              cells: (row.cells || []).map((cell: any) => ({
                type: 'tableCell',
                content: cell.text
                  ? parseInlineFormatting(cell.text)
                  : [{ type: 'text', text: '', styles: {} }],
                props: {
                  colspan: cell.cs || 1,
                  rowspan: cell.rs || 1,
                  backgroundColor: cell.bg || 'default',
                  textColor: 'default',
                  textAlignment: 'left',
                },
              })),
            }));
            trueColCount = tableRows!.reduce((max: number, row: any) => {
              const span = row.cells.reduce(
                (sum: number, cell: any) => sum + (cell.props?.colspan || 1),
                0,
              );
              return Math.max(max, span);
            }, 0);
          }
        } catch { /* not JSON, fall through to pipe format */ }
      }

      // Fall back to pipe format
      if (!tableRows) {
        tableRows = [];
        for (const innerLine of innerLines) {
          const rowTrimmed = innerLine.trim();
          // Parse separator row — may contain column widths (e.g., | 120 | --- | 240 |)
          if (/^\|[\s\-:\d]+(\|[\s\-:\d]+)*\|?$/.test(rowTrimmed) && rowTrimmed.includes('-')) {
            // Check if separator has numeric widths
            const segs = rowTrimmed.split('|').slice(1, -1);
            const widths = segs.map((s: string) => {
              const num = parseInt(s.trim(), 10);
              return isNaN(num) ? null : num;
            });
            if (widths.some((w: any) => w !== null)) {
              parsedWidths = widths;
            }
            continue;
          }
          if (!rowTrimmed.startsWith('|')) continue;

          const segments = rowTrimmed.split('|').slice(1, -1);
          if (segments.length === 0) continue;

          const cells = segments.map((cellText: string) => {
            let trimmedCell = cellText.trim().replace(/\\\|/g, '|');
            let backgroundColor = 'default';
            const bgMatch = trimmedCell.match(/^\{bg:([a-z]+)\}/);
            if (bgMatch) {
              backgroundColor = bgMatch[1];
              trimmedCell = trimmedCell.slice(bgMatch[0].length);
            }
            return {
              type: 'tableCell',
              content: trimmedCell
                ? parseInlineFormatting(trimmedCell)
                : [{ type: 'text', text: '', styles: {} }],
              props: {
                colspan: 1,
                rowspan: 1,
                backgroundColor,
                textColor: 'default',
                textAlignment: 'left',
              },
            };
          });
          tableRows.push({ cells });
        }
        trueColCount = tableRows[0]?.cells?.length || 0;
      }

      if (tableRows.length > 0) {
        blocks.push({
          type: 'table',
          content: {
            type: 'tableContent',
            columnWidths: parsedWidths || Array(trueColCount || tableRows[0].cells.length).fill(null),
            rows: tableRows,
          },
        });
      }
      continue;
    }

    // Code block
    if (trimmed.startsWith('```')) {
      const rawLang = trimmed.slice(3).trim();
      i++;
      let code = '';
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code += lines[i] + '\n';
        i++;
      }
      i++; // Skip closing ```

      // Map common aliases to Shiki language IDs
      const langMap: Record<string, string> = {
        'js': 'javascript', 'ts': 'typescript', 'py': 'python',
        'rb': 'ruby', 'rs': 'rust', 'kt': 'kotlin', 'golang': 'go',
        'sh': 'bash', 'shell': 'bash', 'zsh': 'bash',
        'dockerfile': 'docker', 'objc': 'objective-c', 'objectivec': 'objective-c',
        'cs': 'csharp', 'c#': 'csharp', 'c++': 'cpp',
        'md': 'markdown', 'tex': 'latex', 'yml': 'yaml', 'ps1': 'powershell',
      };
      const language = rawLang ? (langMap[rawLang.toLowerCase()] || rawLang.toLowerCase()) : undefined;

      blocks.push({
        type: 'codeBlock',
        props: { language: language || undefined },
        content: [{ type: 'text', text: code.trim(), styles: {} }],
      });
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      blocks.push({
        type: 'heading',
        props: { level },
        content: [{ type: 'text', text, styles: {} }],
      });
      i++;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const text = trimmed.slice(1).trim();
      blocks.push({
        type: 'quote',
        content: [{ type: 'text', text, styles: {} }],
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*]{3,}$/.test(trimmed)) {
      blocks.push({
        type: 'divider',
      });
      i++;
      continue;
    }

    // Checkbox
    const checkboxMatch = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
    if (checkboxMatch) {
      const checked = checkboxMatch[1] === 'x';
      const text = checkboxMatch[2];
      blocks.push({
        type: 'checkListItem',
        props: { checked },
        content: [{ type: 'text', text, styles: {} }],
      });
      i++;
      continue;
    }

    // Numbered list
    const numberedListMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedListMatch) {
      const text = numberedListMatch[2];
      blocks.push({
        type: 'numberedListItem',
        content: [{ type: 'text', text, styles: {} }],
      });
      i++;
      continue;
    }

    // Bullet list
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const text = trimmed.slice(2);
      blocks.push({
        type: 'bulletListItem',
        content: [{ type: 'text', text, styles: {} }],
      });
      i++;
      continue;
    }

    // Video: <video-block url="..." caption="..." width="..." align="..."></video-block>
    const videoTagAttrs = matchSelfClosingTag(trimmed, 'video-block');
    if (videoTagAttrs) {
      const vProps: Record<string, any> = {
        url: videoTagAttrs.url || '',
        caption: videoTagAttrs.caption || '',
        textAlignment: videoTagAttrs.align || 'center',
      };
      if (videoTagAttrs.width) {
        const width = Number(videoTagAttrs.width);
        if (Number.isFinite(width) && width > 0) vProps.previewWidth = width;
      }
      blocks.push({
        type: 'video',
        props: vProps,
      });
      i++;
      continue;
    }

    // Video legacy: ![caption](url)<!-- video:width&alignment -->
    const videoMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)<!-- video:([^&]*)&([^ ]*) -->/);
    if (videoMatch) {
      const vAlt = videoMatch[1];
      const vSrc = videoMatch[2];
      const vSerializedWidth = videoMatch[3];
      const vSerializedAlign = videoMatch[4];
      const vProps: Record<string, any> = {
        url: vSrc,
        caption: vAlt,
        textAlignment: vSerializedAlign || 'center',
      };
      if (vSerializedWidth) {
        vProps.previewWidth = Number(vSerializedWidth);
      }
      blocks.push({
        type: 'video',
        props: vProps,
      });
      i++;
      continue;
    }

    // Image: <image-block url="..." caption="..." width="..." align="..."></image-block>
    const imageTagAttrs = matchSelfClosingTag(trimmed, 'image-block');
    if (imageTagAttrs) {
      const props: Record<string, any> = {
        url: imageTagAttrs.url || '',
        caption: imageTagAttrs.caption || '',
        textAlignment: imageTagAttrs.align || 'center',
      };
      if (imageTagAttrs.width) {
        const width = Number(imageTagAttrs.width);
        if (Number.isFinite(width) && width > 0) props.previewWidth = width;
      }
      blocks.push({
        type: 'image',
        props,
      });
      i++;
      continue;
    }

    // Image legacy: ![caption](url), ![caption](url "title"), or ![caption](url)<!-- img:width&alignment -->
    const imageMatch = line.match(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)(?:<!-- img:([^&]*)&([^ ]*) -->)?/);
    if (imageMatch) {
      const alt = imageMatch[1];
      const src = imageMatch[2];
      const markdownTitle = imageMatch[3];
      const serializedWidth = imageMatch[4];
      const serializedAlign = imageMatch[5];
      const props: Record<string, any> = {
        url: src,
        caption: alt || markdownTitle || '',
        textAlignment: serializedAlign || 'center',
      };
      if (serializedWidth) {
        props.previewWidth = Number(serializedWidth);
      }
      blocks.push({
        type: 'image',
        props,
      });
      i++;
      continue;
    }

    // Audio: <audio-block url="..." name="..." caption="..." preview="..."></audio-block>
    const audioTagAttrs = matchSelfClosingTag(trimmed, 'audio-block');
    if (audioTagAttrs) {
      blocks.push({
        type: 'audio',
        props: {
          url: audioTagAttrs.url || '',
          name: audioTagAttrs.name || '',
          caption: audioTagAttrs.caption || '',
          showPreview: audioTagAttrs.preview !== 'false',
        },
      });
      i++;
      continue;
    }

    // Audio legacy: ![name](url)<!-- audio:caption&showPreview -->
    const audioMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)<!-- audio:([^&]*)&([^ ]*) -->/);
    if (audioMatch) {
      const aName = audioMatch[1];
      const aSrc = audioMatch[2];
      const aCaption = audioMatch[3];
      const aShowPreview = audioMatch[4] !== 'false';
      blocks.push({
        type: 'audio',
        props: {
          url: aSrc,
          name: aName,
          caption: aCaption,
          showPreview: aShowPreview,
        },
      });
      i++;
      continue;
    }

    // File: <file-block url="..." name="..." caption="..."></file-block>
    const fileTagAttrs = matchSelfClosingTag(trimmed, 'file-block');
    if (fileTagAttrs) {
      blocks.push({
        type: 'file',
        props: {
          url: fileTagAttrs.url || '',
          name: fileTagAttrs.name || '',
          caption: fileTagAttrs.caption || '',
        },
      });
      i++;
      continue;
    }

    // File legacy: [name](url)<!-- file:caption --> (must check AFTER image/audio patterns)
    const fileMatch = line.match(/^\[([^\]]*)\]\(([^)]+)\)<!-- file:([^ ]*) -->$/);
    if (fileMatch) {
      const fName = fileMatch[1];
      const fSrc = fileMatch[2];
      const fCaption = fileMatch[3];
      blocks.push({
        type: 'file',
        props: {
          url: fSrc,
          name: fName,
          caption: fCaption,
        },
      });
      i++;
      continue;
    }

    // Page reference: <page-ref data-id="uuid"></page-ref> (legacy: <!-- pageref:uuid -->)
    const pagerefId = trimmed.match(/^<page-ref\s+data-id="([a-f0-9]{32})"\s*><\/page-ref>$/)?.[1]
      || trimmed.match(/^<!--\s*pageref:([a-f0-9]{32})\s*-->$/)?.[1];
    if (pagerefId) {
      blocks.push({
        type: 'pageReference',
        props: { pageId: pagerefId },
      });
      i++;
      continue;
    }

    // Bookmark: <book-mark data-url="url"></book-mark> (legacy: <!-- bookmark:url -->)
    const bookmarkUrl = trimmed.match(/^<book-mark\s+data-url="([^"]+)"\s*><\/book-mark>$/)?.[1]
      || trimmed.match(/^<!--\s*bookmark:(https?:\/\/.+)\s*-->$/)?.[1];
    if (bookmarkUrl) {
      blocks.push({
        type: 'bookmark',
        props: { url: bookmarkUrl },
      });
      i++;
      continue;
    }

    // Subpage: <sub-page data-id="uuid"></sub-page> (legacy: <!-- subpage:uuid -->)
    const subpageId = trimmed.match(/^<sub-page\s+data-id="([a-f0-9]{32})"\s*><\/sub-page>$/)?.[1]
      || trimmed.match(/^<!--\s*subpage:([a-f0-9]{32})\s*-->$/)?.[1];
    if (subpageId) {
      blocks.push({
        type: 'subpage',
        props: { pageId: subpageId },
      });
      i++;
      continue;
    }

    // Column list: <column-list ratios="50,50"> ... </column-list>
    const columnListMatch = trimmed.match(/^<column-list(?:\s+ratios="([^"]*)")?\s*>$/);
    if (columnListMatch) {
      const ratios = columnListMatch[1] || '50,50';
      const innerLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '</column-list>') {
        innerLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing </column-list>

      // Parse inner content into column blocks
      const innerContent = innerLines.join('\n');
      const columnChildren: any[] = [];

      // Split by <column ratio="N"> tags
      const columnRegex = /<column(?:\s+ratio="(\d+)")?\s*>([\s\S]*?)<\/column>/g;
      let colMatch;
      while ((colMatch = columnRegex.exec(innerContent)) !== null) {
        const ratio = colMatch[1] ? parseInt(colMatch[1]) : 50;
        const colContent = colMatch[2].trim();
        const colBlocks = colContent ? markdownToBlocks(colContent) : [{ type: 'paragraph' }];
        columnChildren.push({
          type: 'column',
          props: { widthRatio: ratio },
          children: colBlocks,
        });
      }

      // Fallback: if no <column> tags found, split evenly
      if (columnChildren.length === 0) {
        const ratioArr = ratios.split(',').map(Number);
        for (const r of ratioArr) {
          columnChildren.push({
            type: 'column',
            props: { widthRatio: r || 50 },
            children: [{ type: 'paragraph' }],
          });
        }
      }

      blocks.push({
        type: 'column_list',
        props: { columnRatios: ratios },
        children: columnChildren,
      });
      continue;
    }

    // Paragraph with inline formatting
    blocks.push({
      type: 'paragraph',
      content: parseInlineFormatting(line),
    });
    i++;
  }

  // BlockNote requires at least one block — return a default empty paragraph
  if (blocks.length === 0) {
    return [{ type: 'paragraph', content: [{ type: 'text', text: '', styles: {} }] }];
  }

  return blocks;
}

/**
 * Extract content between <tagName>...</tagName> from a lines array.
 * Handles multi-line content and nesting (e.g. <content> inside <content>).
 */
function extractTagContent(lines: string[], tagName: string): string {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;

  let startIdx = -1;
  let endIdx = -1;
  let depth = 0;

  for (let j = 0; j < lines.length; j++) {
    const line = lines[j].trim();

    if (startIdx === -1) {
      // Haven't found opening tag yet
      if (line === openTag) {
        startIdx = j;
        depth = 1;
      } else if (line.startsWith(openTag) && line.endsWith(closeTag)) {
        // Single line: <title>text</title>
        return line.slice(openTag.length, line.length - closeTag.length);
      }
    } else {
      // Collecting content
      // Check for nested same-name tags (e.g. <content> inside <content>)
      if (line === openTag) depth++;
      if (line === closeTag) {
        depth--;
        if (depth === 0) {
          endIdx = j;
          break;
        }
      }
    }
  }

  if (startIdx === -1 || endIdx === -1) return '';
  return lines.slice(startIdx + 1, endIdx).join('\n');
}

function matchSelfClosingTag(line: string, tagName: string): Record<string, string> | null {
  const match = line.match(new RegExp(`^<${tagName}\\s+([^>]*?)><\\/${tagName}>$`));
  if (!match) return null;
  return parseTagAttributes(match[1]);
}

function parseTagAttributes(attrText: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrText)) !== null) {
    attrs[match[1]] = unescapeHtmlAttribute(match[2]);
  }
  return attrs;
}

function escapeHtmlAttribute(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function unescapeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Parse inline formatting (bold, italic, code, links)
 */
function parseInlineFormatting(text: string): any[] {
  const content: any[] = [];
  let current = '';
  let i = 0;

  while (i < text.length) {
    // Bold
    if (text.substr(i, 2) === '**') {
      if (current) {
        content.push({ type: 'text', text: current, styles: {} });
        current = '';
      }
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        const boldText = text.slice(i + 2, end);
        content.push({ type: 'text', text: boldText, styles: { bold: true } });
        i = end + 2;
        continue;
      }
    }

    // Italic
    if (text.substr(i, 1) === '*' && text.substr(i, 2) !== '**') {
      if (current) {
        content.push({ type: 'text', text: current, styles: {} });
        current = '';
      }
      const end = text.indexOf('*', i + 1);
      if (end !== -1) {
        const italicText = text.slice(i + 1, end);
        content.push({ type: 'text', text: italicText, styles: { italic: true } });
        i = end + 1;
        continue;
      }
    }

    // Inline code
    if (text[i] === '`') {
      if (current) {
        content.push({ type: 'text', text: current, styles: {} });
        current = '';
      }
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        const codeText = text.slice(i + 1, end);
        content.push({ type: 'text', text: codeText, styles: { code: true } });
        i = end + 1;
        continue;
      }
    }

    // Colored/styled span: <span text-color="red" bg-color="blue" strike="true" underline="true">text</span>
    if (text.substr(i, 5) === '<span') {
      const closeTagEnd = text.indexOf('>', i + 5);
      if (closeTagEnd !== -1) {
        const tagContent = text.slice(i + 5, closeTagEnd);
        const closeSpan = text.indexOf('</span>', closeTagEnd + 1);
        if (closeSpan !== -1) {
          const innerText = text.slice(closeTagEnd + 1, closeSpan);
          if (current) {
            content.push({ type: 'text', text: current, styles: {} });
            current = '';
          }
          // Parse attributes
          const styles: any = {};
          const textColorMatch = tagContent.match(/text-color="([^"]+)"/);
          if (textColorMatch) styles.textColor = textColorMatch[1];
          const bgColorMatch = tagContent.match(/bg-color="([^"]+)"/);
          if (bgColorMatch) styles.backgroundColor = bgColorMatch[1];
          if (tagContent.includes('strike="true"')) styles.strike = true;
          if (tagContent.includes('underline="true"')) styles.underline = true;
          // Recursively parse inner text for bold/italic/code/link
          const innerContent = parseInlineFormatting(innerText);
          for (const ic of innerContent) {
            if (typeof ic === 'string') {
              content.push({ type: 'text', text: ic, styles: { ...styles } });
            } else {
              content.push({ ...ic, styles: { ...styles, ...(ic.styles || {}) } });
            }
          }
          i = closeSpan + 7;
          continue;
        }
      }
    }

    // Link
    if (text[i] === '[') {
      const linkEnd = text.indexOf(']', i);
      if (linkEnd !== -1 && text[linkEnd + 1] === '(') {
        const urlEnd = text.indexOf(')', linkEnd + 2);
        if (urlEnd !== -1) {
          const linkText = text.slice(i + 1, linkEnd);
          const url = text.slice(linkEnd + 2, urlEnd);
          if (current) {
            content.push({ type: 'text', text: current, styles: {} });
            current = '';
          }
          // Mention link: [mention:url](url) → mark text with zero-width prefix
          const MENTION_PREFIX = '​​';
          if (linkText.startsWith('mention:') && linkText.slice(8) === url) {
            content.push({ type: 'link', href: url, content: [{ type: 'text', text: MENTION_PREFIX + url, styles: {} }] });
          } else {
            content.push({ type: 'link', href: url, content: [{ type: 'text', text: linkText, styles: {} }] });
          }
          i = urlEnd + 1;
          continue;
        }
      }
    }

    current += text[i];
    i++;
  }

  if (current) {
    content.push({ type: 'text', text: current, styles: {} });
  }

  return content;
}

/**
 * Convert BlockNote blocks to markdown
 */
export function blocksToMarkdown(blocks: any[]): string {
  return blocks.map(block => serializeBlock(block)).join('\n');
}

/**
 * Serialize a single block to markdown, handling toggle blocks and children recursively.
 */
function serializeBlock(block: any): string {
  // Column list — skip if all columns are empty (content was deleted)
  if (block.type === 'column_list') {
    const columns = (block.children || []).filter((col: any) =>
      col.children && col.children.length > 0
    );
    // If no columns have content, omit the entire column_list
    if (columns.length === 0) return '';
    const ratios = block.props?.columnRatios || '50,50';
    const childrenMd = columns.map((col: any) => {
      const ratio = col.props?.widthRatio || 50;
      const colContent = (col.children || []).map((c: any) => serializeBlock(c)).join('\n');
      return `<column ratio="${ratio}">\n${colContent}\n</column>`;
    }).join('\n');
    return `<column-list ratios="${ratios}">\n${childrenMd}\n</column-list>`;
  }

  // Toggle heading
  if (block.type === 'heading' && block.props?.isToggleable) {
    const level = block.props.level || 1;
    const title = getFormattedText(block.content);
    const childrenMd = block.children?.length
      ? block.children.map((c: any) => serializeBlock(c)).join('\n')
      : '';
    return `<toggle-h level="${level}">\n<title>${title}</title>\n<content>${childrenMd ? '\n' + childrenMd + '\n' : ''}</content>\n</toggle-h>`;
  }

  // Toggle list item
  if (block.type === 'toggleListItem') {
    const title = getFormattedText(block.content);
    const childrenMd = block.children?.length
      ? block.children.map((c: any) => serializeBlock(c)).join('\n')
      : '';
    return `<toggle-list>\n<title>${title}</title>\n<content>${childrenMd ? '\n' + childrenMd + '\n' : ''}</content>\n</toggle-list>`;
  }

  // Regular blocks
  const line = serializeRegularBlock(block);

  // If a regular block has children, append them
  if (block.children?.length) {
    const childrenMd = block.children.map((c: any) => serializeBlock(c)).join('\n');
    return line + '\n' + childrenMd;
  }

  return line;
}

/**
 * Serialize a regular (non-toggle) block to a single markdown line.
 */
function serializeRegularBlock(block: any): string {
  switch (block.type) {
    case 'heading': {
      const level = block.props?.level || 1;
      const headingText = getTextContent(block.content);
      return `${'#'.repeat(level)} ${headingText}`;
    }

    case 'paragraph': {
      const paragraphText = getFormattedText(block.content);
      if (paragraphText) {
        return paragraphText;
      }
      // Empty paragraph: use zero-width space marker to survive markdown round-trip
      return '​';
    }

    case 'bulletListItem': {
      const bulletText = getFormattedText(block.content);
      return `- ${bulletText}`;
    }

    case 'numberedListItem': {
      const numberText = getFormattedText(block.content);
      return `1. ${numberText}`;
    }

    case 'checkListItem': {
      const checkboxText = getFormattedText(block.content);
      const checked = block.props?.checked ? 'x' : ' ';
      return `- [${checked}] ${checkboxText}`;
    }

    case 'codeBlock': {
      const language = block.props?.language || '';
      const code = getTextContent(block.content);
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }

    case 'quote': {
      const quoteText = getFormattedText(block.content);
      return `> ${quoteText}`;
    }

    case 'divider':
      return '---';

    case 'image': {
      const url = block.props?.url || '';
      const caption = block.props?.caption || '';
      const previewWidth = block.props?.previewWidth;
      const textAlignment = block.props?.textAlignment;
      const attrs = [
        `url="${escapeHtmlAttribute(url)}"`,
        `caption="${escapeHtmlAttribute(caption)}"`,
      ];
      if (previewWidth) attrs.push(`width="${escapeHtmlAttribute(previewWidth)}"`);
      if (textAlignment) attrs.push(`align="${escapeHtmlAttribute(textAlignment)}"`);
      return `<image-block ${attrs.join(' ')}></image-block>`;
    }

    case 'video': {
      const vUrl = block.props?.url || '';
      const vCaption = block.props?.caption || '';
      const vPreviewWidth = block.props?.previewWidth;
      const vTextAlignment = block.props?.textAlignment;
      const attrs = [
        `url="${escapeHtmlAttribute(vUrl)}"`,
        `caption="${escapeHtmlAttribute(vCaption)}"`,
      ];
      if (vPreviewWidth) attrs.push(`width="${escapeHtmlAttribute(vPreviewWidth)}"`);
      if (vTextAlignment) attrs.push(`align="${escapeHtmlAttribute(vTextAlignment)}"`);
      return `<video-block ${attrs.join(' ')}></video-block>`;
    }

    case 'file': {
      const fUrl = block.props?.url || '';
      const fName = block.props?.name || '';
      const fCaption = block.props?.caption || '';
      return `<file-block url="${escapeHtmlAttribute(fUrl)}" name="${escapeHtmlAttribute(fName)}" caption="${escapeHtmlAttribute(fCaption)}"></file-block>`;
    }

    case 'audio': {
      const aUrl = block.props?.url || '';
      const aName = block.props?.name || '';
      const aCaption = block.props?.caption || '';
      const aShowPreview = block.props?.showPreview !== false;
      return `<audio-block url="${escapeHtmlAttribute(aUrl)}" name="${escapeHtmlAttribute(aName)}" caption="${escapeHtmlAttribute(aCaption)}" preview="${aShowPreview}"></audio-block>`;
    }

    case 'pageReference':
      if (block.props?.pageId) {
        return `<page-ref data-id="${block.props.pageId}"></page-ref>`;
      }
      return '';

    case 'bookmark':
      if (block.props?.url) {
        return `<book-mark data-url="${block.props.url}"></book-mark>`;
      }
      return '';

    case 'subpage':
      if (block.props?.pageId) {
        return `<sub-page data-id="${block.props.pageId}"></sub-page>`;
      }
      return '';

    case 'table': {
      const tableContent = block.content;
      if (!tableContent?.rows?.length) return '';
      const rows = tableContent.rows;

      // Check if any cell has colspan > 1 or rowspan > 1
      const hasMergedCells = rows.some((row: any) =>
        (row.cells || []).some((cell: any) =>
          (cell.props?.colspan || 1) > 1 || (cell.props?.rowspan || 1) > 1,
        ),
      );

      // Extract column widths (numbers in pixels, or null for auto)
      const columnWidths: (number | null)[] = tableContent.columnWidths || [];

      if (hasMergedCells) {
        // Use JSON format for tables with merged cells — pipe format can't represent rowspan
        const jsonData = rows.map((row: any) => ({
          cells: (row.cells || []).map((cell: any) => ({
            text: getFormattedText(cell.content),
            cs: cell.props?.colspan || 1,
            rs: cell.props?.rowspan || 1,
            bg: cell.props?.backgroundColor || 'default',
          })),
        }));
        // Include column widths if any are non-null
        const widthsObj: any = {};
        const hasWidths = columnWidths.some((w: any) => w !== null && w !== undefined);
        if (hasWidths) {
          widthsObj.widths = columnWidths;
        }
        const payload = hasWidths ? { ...widthsObj, rows: jsonData } : jsonData;
        return `<table-block>\n${JSON.stringify(payload)}\n</table-block>`;
      }

      // Standard pipe format for tables without merged cells
      const colCount = rows[0]?.cells?.length || 0;
      if (colCount === 0) return '';

      const serializeCell = (cell: any) => {
        let text = getFormattedText(cell.content).replace(/\|/g, '\\|');
        const bg = cell.props?.backgroundColor;
        if (bg && bg !== 'default') {
          text = `{bg:${bg}}` + text;
        }
        return text;
      };

      const lines: string[] = [];
      lines.push('<table-block>');
      lines.push('| ' + rows[0].cells.map(serializeCell).join(' | ') + ' |');
      // Encode column widths in separator line: | 120 | --- | 240 |
      const hasWidths = columnWidths.some((w: any) => w !== null && w !== undefined);
      if (hasWidths) {
        lines.push('| ' + columnWidths.map((w: any) => (w != null ? String(w) : '---')).join(' | ') + ' |');
      } else {
        lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
      }
      for (let r = 1; r < rows.length; r++) {
        lines.push('| ' + rows[r].cells.map(serializeCell).join(' | ') + ' |');
      }
      lines.push('</table-block>');
      return lines.join('\n');
    }

    default:
      return `<!-- Unknown block type: ${block.type} -->`;
  }
}

/**
 * Extract plain text from block content
 */
function getTextContent(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c.text || ''))
      .join('');
  }
  return content.text || '';
}

/**
 * Extract formatted text from block content
 */
function getFormattedText(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;

        // BlockNote native link format: { type: 'link', href, content: [...] }
        if (c.type === 'link' && c.href) {
          const innerText = getFormattedText(c.content);
          // Mention link: zero-width prefix → serialize as mention:href
          const MENTION_PREFIX = '​​';
          if (innerText.startsWith(MENTION_PREFIX)) {
            return `[mention:${c.href}](${c.href})`;
          }
          return `[${innerText}](${c.href})`;
        }

        let text = c.text || '';

        if (c.styles?.code) text = `\`${text}\``;
        if (c.styles?.bold) text = `**${text}**`;
        if (c.styles?.italic) text = `*${text}*`;
        if (c.link) text = `[${text}](${c.link})`;

        // Wrap color/background/strike/underline in HTML span for persistence
        const colorAttrs: string[] = [];
        if (c.styles?.textColor && c.styles.textColor !== 'default') {
          colorAttrs.push(`text-color="${c.styles.textColor}"`);
        }
        if (c.styles?.backgroundColor && c.styles.backgroundColor !== 'default') {
          colorAttrs.push(`bg-color="${c.styles.backgroundColor}"`);
        }
        if (c.styles?.strike) {
          colorAttrs.push('strike="true"');
        }
        if (c.styles?.underline) {
          colorAttrs.push('underline="true"');
        }
        if (colorAttrs.length > 0) {
          text = `<span ${colorAttrs.join(' ')}>${text}</span>`;
        }

        return text;
      })
      .join('');
  }
  return content.text || '';
}
