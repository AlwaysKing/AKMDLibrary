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
    if (trimmed === '\u200B') {
      blocks.push({
        type: 'paragraph',
        content: [{ type: 'text', text: '', styles: {} }],
      });
      i++;
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
  const lines: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        const level = block.props?.level || 1;
        const headingText = getTextContent(block.content);
        lines.push(`${'#'.repeat(level)} ${headingText}`);
        break;

      case 'paragraph':
        const paragraphText = getFormattedText(block.content);
        if (paragraphText) {
          lines.push(paragraphText);
        } else {
          // Empty paragraph: use zero-width space marker to survive markdown round-trip
          lines.push('\u200B');
        }
        break;

      case 'bulletListItem':
        const bulletText = getFormattedText(block.content);
        lines.push(`- ${bulletText}`);
        break;

      case 'numberedListItem':
        const numberText = getFormattedText(block.content);
        lines.push(`1. ${numberText}`);
        break;

      case 'checkListItem':
        const checkboxText = getFormattedText(block.content);
        const checked = block.props?.checked ? 'x' : ' ';
        lines.push(`- [${checked}] ${checkboxText}`);
        break;

      case 'codeBlock':
        const language = block.props?.language || '';
        const code = getTextContent(block.content);
        lines.push(`\`\`\`${language}`);
        lines.push(code);
        lines.push('```');
        break;

      case 'quote':
        const quoteText = getFormattedText(block.content);
        lines.push(`> ${quoteText}`);
        break;

      case 'divider':
        lines.push('---');
        break;

      case 'image':
        const url = block.props?.url || '';
        const caption = block.props?.caption || '';
        lines.push(`![${caption}](${url})`);
        break;

      case 'pageReference':
        if (block.props?.pageId) {
          lines.push(`<page-ref data-id="${block.props.pageId}"></page-ref>`);
        }
        break;

      case 'bookmark':
        if (block.props?.url) {
          lines.push(`<book-mark data-url="${block.props.url}"></book-mark>`);
        }
        break;

      case 'subpage':
        if (block.props?.pageId) {
          lines.push(`<sub-page data-id="${block.props.pageId}"></sub-page>`);
        }
        break;

      case 'table':
        lines.push('<!-- Table not fully supported in markdown round-trip -->');
        break;

      default:
        lines.push(`<!-- Unknown block type: ${block.type} -->`);
    }
  }

  return lines.join('\n');
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
