import { Link } from "react-router-dom";
import { css } from "@linaria/core";
import { Card, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";

const container = css`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  text-align: center;
`;

const content = css`
  max-width: 500px;
  width: 100%;
`;

const errorCode = css`
  font-size: 72px;
  font-weight: var(--haze-weight-bold);
  color: var(--haze-color-primary);
  margin: 0;
  line-height: 1;
`;

const title = css`
  font-size: var(--haze-text-2xl);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  margin: var(--haze-space-4) 0 var(--haze-space-2) 0;
`;

const description = css`
  color: var(--haze-color-text-secondary);
  margin: 0 0 var(--haze-space-8) 0;
  line-height: var(--haze-leading-relaxed);
`;

const actions = css`
  display: flex;
  gap: var(--haze-space-4);
  justify-content: center;
  flex-wrap: wrap;

  a {
    text-decoration: none;
  }
`;

export function NotFoundPage() {
  return (
    <div className={container}>
      <Card className={content}>
        <CardContent>
          <div className={errorCode}>404</div>
          <h1 className={title}>Page Not Found</h1>
          <p className={description}>
            Sorry, the page you are looking for does not exist. The link may be
            incorrect or the page has been moved.
          </p>

          <div className={actions}>
            <Link to="/">
              <Button variant="primary">Go Home</Button>
            </Link>
            <Link to="/search">
              <Button variant="outline">Search</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
