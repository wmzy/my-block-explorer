import React from "react";
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
  font-weight: 800;
  color: #3b82f6;
  margin: 0;
  line-height: 1;
`;

const title = css`
  font-size: 24px;
  font-weight: 600;
  color: #1e293b;
  margin: 16px 0 8px 0;

  @media (prefers-color-scheme: dark) {
    color: #e2e8f0;
  }
`;

const description = css`
  color: #64748b;
  margin: 0 0 32px 0;
  line-height: 1.6;

  @media (prefers-color-scheme: dark) {
    color: #94a3b8;
  }
`;

const actions = css`
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
`;

export function NotFoundPage() {
  return (
    <div className={container}>
      <Card className={content}>
        <CardContent>
          <div className={errorCode}>404</div>
          <h1 className={title}>页面未找到</h1>
          <p className={description}>
            抱歉，您访问的页面不存在。可能是链接错误或页面已被移动。
          </p>

          <div className={actions}>
            <Button as={Link} to="/" variant="primary">
              返回首页
            </Button>
            <Button as={Link} to="/search" variant="outline">
              搜索数据
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
