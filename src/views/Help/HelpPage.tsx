// Help topic page (/help/:topic): renders ONE topic from the shared pure
// model (./helpContent) — the same content the /help index summarizes,
// so the two can never disagree — plus a "where to find it in the app"
// line and links to the sibling topics and back to the index.
//
// An unknown :topic is a 404 by construction, NOT a themed page: the
// router's notFound view already renders the app-wide 404 card, and
// failing there keeps the deep-link contract that a mistyped help URL
// behaves like any other mistyped URL. (RouterError is the loader-failure
// view; there is no loader here, so a plain null return is correct.)
//
// Like the index, it renders the chain-aware top bar through the
// remembered chain and fetches nothing — the help section works with the
// backend offline.
import { css } from '@linaria/core';
import { NotFoundError, navigate } from '@native-router/core';
import { TypedLink, useMatched, useRouter } from '@native-router/react';

import TopNavigation from '@/components/TopNavigation';
import { Card, CardContent, CardTitle } from '@/components/ui/Card';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { readRememberedChainId } from '@/views/Home/Landing';
import { findHelpTopic, relatedHelpTopics } from './helpContent';

const sectionCardStyle = css`
  margin-bottom: var(--haze-space-6);
`;

const bodyParagraph = css`
  margin: var(--haze-space-3) 0 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);

  &:first-of-type {
    margin-top: 0;
  }
`;

const whereStyle = css`
  margin: var(--haze-space-3) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  line-height: var(--haze-leading-relaxed);
`;

const linkStyle = css`
  color: var(--haze-color-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

// The two-column term/meaning list (symptoms, health fields). Same 375px
// collapse as the index glossary and the old standalone page's health
// list: the label stacks above its meaning on narrow viewports.
const factList = css`
  margin: var(--haze-space-5) 0 0;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-4);
`;

const factItem = css`
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: var(--haze-space-3);
  align-items: start;

  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--haze-space-1);
  }
`;

const factLabelStyle = css`
  margin: 0;
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  word-break: break-word;
`;

const factDetailStyle = css`
  margin: 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);
`;

const topicList = css`
  margin: var(--haze-space-5) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-3);
`;

const topicItem = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
`;

const topicTitleStyle = css`
  font-weight: var(--haze-weight-semibold);
  font-size: var(--haze-text-sm);
`;

const topicSummaryStyle = css`
  margin: 0;
  color: var(--haze-color-text-secondary);
  font-size: var(--haze-text-sm);
  line-height: var(--haze-leading-relaxed);
`;

export default function HelpPage() {
  const router = useRouter();
  const match = useMatched();
  const topic = findHelpTopic(match.params.topic);

  const navChainId = readRememberedChainId() ?? 1;
  const handleNavChainChange = (chainId: number) => {
    void navigate(router, `/chain/${chainId}`).catch(() => undefined);
  };

  // Unknown topic: raise the ROUTER's 404, which the app's notFound prop
  // renders (src/views/NotFound.tsx) — the same treatment any other
  // unmatched path gets, so a mistyped help URL is never mistaken for an
  // answer. Returning null here instead would render a blank page: the
  // router only shows its NotFound view for a NotFoundError, not for a
  // matched route that renders nothing.
  if (topic === undefined) {
    throw new NotFoundError(router.history.location.pathname);
  }

  return (
    <>
      <TopNavigation currentChainId={navChainId} onChainChange={handleNavChainChange} />
      <PageContainer narrow>
        <PageHeader title={topic.title} chainInfo={topic.summary} />

        <Card className={sectionCardStyle}>
          <CardContent>
            {topic.body.map(paragraph => (
              <p key={paragraph.slice(0, 32)} className={bodyParagraph}>
                {paragraph}
              </p>
            ))}
            <p className={whereStyle}>
              <strong>Where to find it:</strong> {topic.where}
            </p>
          </CardContent>
        </Card>

        {/* Verbatim error strings, when the topic has them: the text a
            reader pastes in, next to what it means and what to do. */}
        {topic.quotes !== undefined && (
          <Card className={sectionCardStyle}>
            <CardContent>
              <CardTitle as="h2">Symptoms, verbatim</CardTitle>
              <dl className={factList}>
                {topic.quotes.map(({ text, detail }) => (
                  <div key={text} className={factItem}>
                    <dt className={factLabelStyle}>{text}</dt>
                    <dd className={factDetailStyle}>{detail}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}

        {/* Reference table (the /api/health field meanings). */}
        {topic.table !== undefined && (
          <Card className={sectionCardStyle}>
            <CardContent>
              <CardTitle as="h2">{topic.table.title}</CardTitle>
              {topic.table.intro !== undefined && (
                <p className={bodyParagraph}>{topic.table.intro}</p>
              )}
              <dl className={factList}>
                {topic.table.rows.map(({ label, detail }) => (
                  <div key={label} className={factItem}>
                    <dt className={factLabelStyle}>{label}</dt>
                    <dd className={factDetailStyle}>{detail}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}

        <Card className={sectionCardStyle}>
          <CardContent>
            <CardTitle as="h2">Other topics</CardTitle>
            <ul className={topicList}>
              {relatedHelpTopics(topic.slug).map(other => (
                <li key={other.slug} className={topicItem}>
                  <TypedLink to={`/help/${other.slug}`} className={linkStyle}>
                    <span className={topicTitleStyle}>{other.title}</span>
                  </TypedLink>
                  <p className={topicSummaryStyle}>{other.summary}</p>
                </li>
              ))}
            </ul>
            <p className={whereStyle}>
              <TypedLink to="/help" className={linkStyle}>
                ← All help topics
              </TypedLink>
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    </>
  );
}
