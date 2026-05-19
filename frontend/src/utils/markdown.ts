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

    // Code block
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      i++;
      let code = '';
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code += lines[i] + '\n';
        i++;
      }
      i++; // Skip closing ```

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

    // Image
    const imageMatch = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (imageMatch) {
      const alt = imageMatch[1];
      const src = imageMatch[2];
      blocks.push({
        type: 'image',
        props: {
          url: src,
          caption: alt,
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
          content.push({ type: 'text', text: linkText, styles: {}, link: url });
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
      return `![${caption}](${url})`;
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

    case 'table':
      return '<!-- Table not fully supported in markdown round-trip -->';

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

        let text = c.text || '';

        if (c.styles?.bold) text = `**${text}**`;
        if (c.styles?.italic) text = `*${text}*`;
        if (c.styles?.code) text = `\`${text}\``;
        if (c.link) text = `[${text}](${c.link})`;

        return text;
      })
      .join('');
  }
  return content.text || '';
}
