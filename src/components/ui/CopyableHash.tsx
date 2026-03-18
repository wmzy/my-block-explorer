import { css, cx } from "@linaria/core";
import { Tooltip, useToast } from "haze-ui";
import { linkStyle } from "./DataTable";
import { Link } from "react-router-dom";

const copyable = css`
  cursor: pointer;
  &:hover {
    opacity: 0.8;
  }
`;

type CopyableHashProps = {
  value: string;
  truncated?: string;
  href?: string;
  className?: string;
};

export function CopyableHash({ value, truncated, href, className }: CopyableHashProps) {
  const toast = useToast();

  const handleCopy = async (e: React.MouseEvent) => {
    if (href) return;
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      toast("Copied to clipboard!", { variant: "success", duration: 2000 });
    } catch {
      toast("Failed to copy", { variant: "danger", duration: 2000 });
    }
  };

  const display = truncated ?? value;

  const content = href ? (
    <Link to={href} className={cx(linkStyle, className)}>
      {display}
    </Link>
  ) : (
    <span className={cx(linkStyle, copyable, className)} onClick={handleCopy}>
      {display}
    </span>
  );

  return (
    <Tooltip content={value} position="top">
      {content}
    </Tooltip>
  );
}
