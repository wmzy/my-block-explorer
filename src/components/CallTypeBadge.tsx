// The trace family's one call-type badge: the shared color palette over
// Geth callTracer types — read-only frames blue, code-executing frames in
// place purple, creations green, selfdestructs amber, everything else
// (CALL and future types) neutral — the badge still names unknown types.
// One definition for the tx page's Call Trace card, the address tab's
// internal-tx tables and the block page's traced sweep (each used to
// carry its own copy of the switch).
import { Badge, type BadgeProps } from '@/components/ui/Badge';

const variantForType = (type: string): NonNullable<BadgeProps['variant']> => {
  switch (type) {
    case 'STATICCALL':
      return 'info';
    case 'DELEGATECALL':
      return 'purple';
    case 'CREATE':
    case 'CREATE2':
      return 'success';
    case 'SELFDESTRUCT':
      return 'warning';
    default:
      return 'default';
  }
};

export type CallTypeBadgeProps = {
  /** Call type the palette keys on — pass the canonical uppercase form. */
  type: string;
  /** Rendered label; defaults to `type` (records render the raw stored casing). */
  label?: string;
};

export function CallTypeBadge({ type, label = type }: CallTypeBadgeProps) {
  return (
    <Badge variant={variantForType(type)} size="sm">
      {label}
    </Badge>
  );
}
