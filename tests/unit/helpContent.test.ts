// Help content model contract: the invariants the /help index and the
// /help/:topic page both render from. The page render itself is covered
// by tests/unit/pages/helpPage.test.tsx; this file pins the model —
// because a model invariant broken here silently degrades the whole
// section (a duplicate slug is an ambiguous route param, an empty body is
// a blank page, a link pointing at a slug that does not exist is a dead
// card).
//
// The honesty contract is also asserted mechanically: the help copy must
// not claim completeness. The words that would break it are listed, so
// adding one to the content fails here rather than shipping a promise
// this app cannot keep.
import { describe, it, expect } from 'vitest';

import {
  FAQ,
  GLOSSARY,
  HELP_INDEX_TITLE,
  HELP_SECTION_DESCRIPTION,
  HELP_TOPICS,
  KEYBOARD_SHORTCUTS,
  findHelpTopic,
  relatedHelpTopics,
} from '@/views/Help/helpContent';

// Wording that would overstate what the app actually knows. "complete"
// appears legitimately in the deep-scan and overload contexts, so the
// assertion is scoped to the phrases that make a completeness PROMISE.
const OVERCLAIMING_PHRASES = [
  'all data',
  'every transaction ever',
  'always complete',
  'fully complete',
  'guaranteed',
  '100% accurate',
];

const topicSlugs = HELP_TOPICS.map(topic => topic.slug);

describe('help content model', () => {
  it('exposes the slugs the /help/:topic route is documented against', () => {
    // The URL for a topic is a public surface (the old standalone
    // /help/troubleshooting page became this slug and must keep working),
    // so the set is pinned, not just its shape.
    expect(topicSlugs).toEqual([
      'troubleshooting',
      'getting-started',
      'navigation',
      'addresses',
      'contracts',
      'tokens',
      'storage',
      'rpc-settings',
    ]);
  });

  it('resolves every topic by its own slug and nothing else', () => {
    for (const topic of HELP_TOPICS) {
      expect(findHelpTopic(topic.slug)).toBe(topic);
    }
    // Unknown and absent slugs stay unresolved — the page turns an
    // undefined topic into the router's 404, never a blank page.
    expect(findHelpTopic('nope')).toBeUndefined();
    expect(findHelpTopic('')).toBeUndefined();
    expect(findHelpTopic(undefined)).toBeUndefined();
    // Case matters: a hand-typed /help/Troubleshooting is a 404, not a
    // silent redirect into content.
    expect(findHelpTopic('Troubleshooting')).toBeUndefined();
  });

  it('keeps slugs url-safe and unique', () => {
    for (const slug of topicSlugs) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
    expect(new Set(topicSlugs).size).toBe(HELP_TOPICS.length);
  });

  it('gives every topic a title, a summary and at least one body paragraph', () => {
    for (const topic of HELP_TOPICS) {
      expect(topic.title.trim(), topic.slug).not.toBe('');
      expect(topic.summary.trim(), topic.slug).not.toBe('');
      expect(topic.where.trim(), topic.slug).not.toBe('');
      expect(topic.body.length, topic.slug).toBeGreaterThan(0);
      for (const paragraph of topic.body) {
        expect(paragraph.trim(), topic.slug).not.toBe('');
      }
    }
  });

  it('never repeats a paragraph inside one topic (duplicates read as bugs)', () => {
    for (const topic of HELP_TOPICS) {
      // The topic page keys body paragraphs by their first 32
      // chars (HelpPage.tsx), so the uniqueness this test pins
      // must be measured over the SAME prefix — a 40-char
      // uniqueness would let two paragraphs share a 32-char
      // prefix and collide as React keys while staying green.
      const keys = topic.body.map(paragraph => paragraph.slice(0, 32));
      expect(new Set(keys).size, topic.slug).toBe(keys.length);
    }
  });

  it('names troubleshooting first — it is the topic people arrive with a symptom for', () => {
    expect(HELP_TOPICS[0]?.slug).toBe('troubleshooting');
  });

  it('carries the provider symptoms and the health fields on the troubleshooting topic', () => {
    const topic = findHelpTopic('troubleshooting');
    // The verbatim symptom strings, quoted as a provider emits them. The
    // match is over the WHOLE entry (label + meaning): a reader searches
    // for the method name they saw in the console, and it must be
    // reachable on this page wherever it lives in the pair.
    const quotes = (topic?.quotes ?? []).map(quote => `${quote.text} ${quote.detail}`);
    for (const expected of [
      /block range too large/,
      /results exceed limit/,
      /historical state/,
      /missing trie node/,
      /unsupported card/,
      /debug_traceTransaction/,
      /HTTP 429/,
      /Retry-After/,
    ]) {
      expect(quotes.some(quote => expected.test(quote)), expected.source).toBe(true);
    }
    for (const quote of topic?.quotes ?? []) {
      expect(quote.text.trim(), 'a symptom needs a label').not.toBe('');
      expect(quote.detail.trim()).not.toBe('');
    }

    // Every field /api/health actually returns.
    const fields = topic?.table?.rows.map(row => row.label) ?? [];
    expect(fields).toEqual([
      'status',
      'adminTokenConfigured',
      'debugApiEnabled',
      'version',
      'timestamp',
    ]);
  });

  it('offers every other topic from a topic page and keeps the section complete', () => {
    for (const topic of HELP_TOPICS) {
      const related = relatedHelpTopics(topic.slug);
      expect(related.map(other => other.slug), topic.slug).toEqual(
        topicSlugs.filter(slug => slug !== topic.slug),
      );
      // Never links to itself, never drops one.
      expect(related.find(other => other.slug === topic.slug)).toBeUndefined();
    }
  });

  it('keeps the section identity constants worded once', () => {
    expect(HELP_INDEX_TITLE).toBe('Help');
    // The og:description derivation and the index subtitle are separate
    // strings by design (one is the tab/heading, the other the share
    // blurb); what must hold is that the blurb is non-empty and names
    // the section.
    expect(HELP_SECTION_DESCRIPTION).toContain('this explorer works');
  });

  it('describes the palette shortcut as Ctrl+K / ⌘K and the real keys', () => {
    const keys = KEYBOARD_SHORTCUTS.map(shortcut => shortcut.keys);
    expect(keys.some(key => key.includes('Ctrl+K') && key.includes('⌘K'))).toBe(true);
    expect(keys).toContain('↑ / ↓');
    expect(keys).toContain('Enter');
    expect(keys).toContain('Esc');
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      expect(shortcut.action.trim()).not.toBe('');
    }
  });

  it('defines each glossary term exactly once, with a real definition', () => {
    const terms = GLOSSARY.map(entry => entry.term);
    expect(new Set(terms).size).toBe(terms.length);
    for (const entry of GLOSSARY) {
      expect(entry.meaning.trim(), entry.term).not.toBe('');
      // Every definition is a sentence, not a label repeated back.
      expect(entry.meaning.length, entry.term).toBeGreaterThan(30);
    }
  });

  it('answers every FAQ question with at least one paragraph', () => {
    const questions = FAQ.map(entry => entry.question);
    expect(new Set(questions).size).toBe(questions.length);
    for (const entry of FAQ) {
      expect(entry.question.trim().endsWith('?'), entry.question).toBe(true);
      expect(entry.answer.length, entry.question).toBeGreaterThan(0);
      for (const paragraph of entry.answer) {
        expect(paragraph.trim(), entry.question).not.toBe('');
      }
    }
  });

  it('never overclaims completeness anywhere in the help copy', () => {
    // Word-boundary matched, not substring: "failed-call data" contains
    // the letters of "all data" and promises nothing. What is banned is
    // the phrase standing on its own as a completeness claim.
    const everything = JSON.stringify({ HELP_TOPICS, GLOSSARY, FAQ, KEYBOARD_SHORTCUTS });
    for (const phrase of OVERCLAIMING_PHRASES) {
      const pattern = new RegExp(`\\b${phrase}\\b`, 'i');
      expect(pattern.test(everything), `help copy must not claim "${phrase}"`).toBe(false);
    }
  });
});
