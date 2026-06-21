import { createReactBlockSpec } from '@blocknote/react';

const MARK_COLORS: Record<string, { text: string; background: string; border: string }> = {
  gray: { text: '#5f5b56', background: '#f0efed', border: '#7d7a75' },
  brown: { text: '#6c4f3e', background: '#f5ede9', border: '#9f765a' },
  red: { text: '#8e322d', background: '#fce9e7', border: '#cf5148' },
  orange: { text: '#8f531d', background: '#fbebde', border: '#d27b2d' },
  yellow: { text: '#7d5b1d', background: '#f9f3dc', border: '#cb9434' },
  green: { text: '#2f6046', background: '#e8f1ec', border: '#50946e' },
  blue: { text: '#24588f', background: '#e5f2fc', border: '#387dc9' },
  purple: { text: '#68417e', background: '#f3ebf9', border: '#9a6bb4' },
  pink: { text: '#86335f', background: '#fae9f1', border: '#c14c8a' },
};

function getMarkColorStyles(color: string | undefined) {
  const palette = MARK_COLORS[color || ''] || null;
  if (!palette) {
    return {
      color: '#2c2c2b',
      background: 'rgba(55, 53, 47, 0.06)',
      borderLeftColor: 'rgba(55, 53, 47, 0.35)',
    };
  }

  return {
    color: palette.text,
    background: palette.background,
    borderLeftColor: palette.border,
  };
}

function MarkComponent({ block, contentRef }: any) {
  const styles = getMarkColorStyles(block.props.color);

  return (
    <div
      className="mark-block"
      style={{
        color: styles.color,
        background: styles.background,
        borderLeftColor: styles.borderLeftColor,
      }}
    >
      <div className="mark-block-content-wrap">
        <div ref={contentRef} className="mark-block-content" />
      </div>
    </div>
  );
}

export const MarkBlockSpec = createReactBlockSpec(
  {
    type: 'mark',
    propSchema: {
      color: { default: 'default' },
    },
    content: 'inline',
  },
  { render: MarkComponent },
);
