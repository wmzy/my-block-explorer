// Help index (/help): the section entry point — every topic as a card,
// then the reference material that is not topic-specific (keyboard
// shortcuts, the data glossary, and the FAQ), then the honest pointers to
// the two other explainers this app ships (the data coverage vocabulary
// and the tools hub).
//
// Not chain-scoped: the content is the same on every chain. The top bar
// still is, so the nav renders with the remembered chain — the same
// fallback order the other chain-less pages (Tools, Ops, Search) use.
// Nothing here fetches: it is copy plus a pure model
// (./helpContent), so it also works with the backend offline.
import { css } from '@linaria/core';
import { navigate } from '@native-router/core';
import { TypedLink, useRouter } from '@native-router/react';

import TopNavigation from '@/components/TopNavigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { readRememberedChainId } from '@/views/Home/Landing';
import {
  FAQ,
  GLOSSARY,
  HELP_INDEX_SUBTITLE,
  HELP_INDEX_TITLE,
  HELP_TOPICS,
  KEYBOARD_SHORTCUTS,
} from './helpContent';

const sectionCardStyle = css`
  margin-bottom: var(--haze-space-6);
`;

// The topic grid is a <ul> (a list of cards is the honest markup), so
// the UA's default 40px left padding and bullets are reset here —
// without that the grid starts 40px in and overflows a 375px viewport.
// min() lets the 280px track shrink below its nominal size on narrow
// screens instead of forcing horizontal scroll; auto-fill collapses it
// to a single column there.
const topicGrid = css`
  list-style: none;
  margin: var(--haze-space-5) 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
  gap: var(--haze-space-4);
  align-items: stretch;
`;

const topicCard = css`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const topicBody = css`
  flex: 1;
`;

const topicLink = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-primary);
  text-decoration: none;
`;

const definitionList = css`
  margin: var(--haze-space-5) 0 0;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-4);
`;

const definitionItem = css`
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: var(--haze-space-3);
  align-items: start;

  /* 375px-clean: the term stacks above its meaning, the same single
     column the health-field and coverage-level rows collapse to. */
  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--haze-space-1);
  }
`;

const termStyle = css`
  margin: 0;
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  word-break: break-word;
`;

const meaningStyle = css`
  margin: 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);
`;

const shortcutList = css`
  margin: var(--haze-space-5) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-3);
`;

const shortcutItem = css`
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: var(--haze-space-3);
  align-items: start;

  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--haze-space-1);
  }
`;

const keysStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
`;

const faqList = css`
  margin: var(--haze-space-5) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-5);
`;

const questionStyle = css`
  margin: 0 0 var(--haze-space-1) 0;
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
`;

const answerStyle = css`
  margin: 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);

  & + & {
    margin-top: var(--haze-space-2);
  }
`;

const paragraphStyle = css`
  margin: var(--haze-space-3) 0 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);

  &:first-of-type {
    margin-top: 0;
  }
`;

const linkStyle = css`
  color: var(--haze-color-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const pointerList = css`
  margin: var(--haze-space-5) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-3);
`;

export default function Help() {
  const router = useRouter();
  // The help section is chain-agnostic; the topbar it renders is not, so
  // it follows the remembered chain (the same fallback as the other
  // chain-less pages) and a chain switch lands on that chain's home.
  const navChainId = readRememberedChainId() ?? 1;
  const handleNavChainChange = (chainId: number) => {
    void navigate(router, `/chain/${chainId}`).catch(() => undefined);
  };

  return (
    <>
      <TopNavigation currentChainId={navChainId} onChainChange={handleNavChainChange} />
      <PageContainer>
        <PageHeader title={HELP_INDEX_TITLE} chainInfo={HELP_INDEX_SUBTITLE} />

        <Card className={sectionCardStyle}>
          <CardContent>
            <CardTitle as="h2">Topics</CardTitle>
            <p className={paragraphStyle}>
              Each topic is its own page, so a specific answer can be linked on its own. Start at the
              one that matches the question you arrived with.
            </p>
            <ul className={topicGrid}>
              {HELP_TOPICS.map(topic => (
                <li key={topic.slug}>
                  <Card className={topicCard}>
                    <CardHeader>
                      <CardTitle>{topic.title}</CardTitle>
                    </CardHeader>
                    <CardContent className={topicBody}>
                      <p className={paragraphStyle}>{topic.summary}</p>
                      <p className={paragraphStyle}>
                        <TypedLink to={`/help/${topic.slug}`} className={topicLink}>
                          Read &rarr;
                        </TypedLink>
                      </p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className={sectionCardStyle}>
          <CardContent>
            <CardTitle as="h2">Keyboard shortcuts</CardTitle>
            <ul className={shortcutList}>
              {KEYBOARD_SHORTCUTS.map(({ keys, action }) => (
                <li key={`${keys}-${action}`} className={shortcutItem}>
                  <span className={keysStyle}>{keys}</span>
                  <p className={meaningStyle}>{action}</p>
                </li>
              ))}
            </ul>
            <p className={paragraphStyle}>
              The command palette is hidden on narrow screens. The{' '}
              <TypedLink to="/tools" className={linkStyle}>
                Tools page
              </TypedLink>{' '}
              lists the same destinations as cards you can tap.
            </p>
          </CardContent>
        </Card>

        <Card className={sectionCardStyle}>
          <CardContent>
            <CardTitle as="h2">Glossary</CardTitle>
            <dl className={definitionList}>
              {GLOSSARY.map(({ term, meaning }) => (
                <div key={term} className={definitionItem}>
                  <dt className={termStyle}>{term}</dt>
                  <dd className={meaningStyle}>{meaning}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className={sectionCardStyle}>
          <CardContent>
            <CardTitle as="h2">Frequently asked</CardTitle>
            <ul className={faqList}>
              {FAQ.map(({ question, answer }) => (
                <li key={question}>
                  <h3 className={questionStyle}>{question}</h3>
                  {answer.map(paragraph => (
                    <p key={paragraph} className={answerStyle}>
                      {paragraph}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className={sectionCardStyle}>
          <CardContent>
            <CardTitle as="h2">Two explainers that live elsewhere</CardTitle>
            <ul className={pointerList}>
              <li className={answerStyle}>
                <TypedLink to="/about/coverage" className={linkStyle}>
                  Data coverage
                </TypedLink>{' '}
                &mdash; what each coverage badge level means, and why a number here can be smaller
                than a full indexer&rsquo;s.
              </li>
              <li className={answerStyle}>
                <TypedLink to="/tools" className={linkStyle}>
                  Tools
                </TypedLink>{' '}
                &mdash; every tool in one page: chain pages, search, signatures, the SQL console, Ops
                and backup &amp; restore.
              </li>
              <li className={answerStyle}>
                The full documentation (install, configuration, API reference, deployment) lives in
                the repository&rsquo;s <span>docs/</span> directory, linked from the README.
              </li>
            </ul>
          </CardContent>
        </Card>
      </PageContainer>
    </>
  );
}
