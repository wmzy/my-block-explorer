// Prose styles shared by the two help views (the index and the topic
// page): one home so the section rhythm, body paragraphs and links cannot
// drift apart. Component-specific lists (FAQ, glossary, term tables) stay
// local to their view — they genuinely differ.
import { css } from '@linaria/core';

export const sectionCardStyle = css`
  margin-bottom: var(--haze-space-6);
`;

export const proseParagraph = css`
  margin: var(--haze-space-3) 0 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);

  &:first-of-type {
    margin-top: 0;
  }
`;

export const proseLink = css`
  color: var(--haze-color-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;
