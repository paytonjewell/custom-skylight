import { ICONS, type IconName } from './icons';

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

/**
 * Icon from the shared set (./icons, Lucide). The `i` class lets CSS adjust them; a CSS stroke-width
 * overrides the default 2 (e.g. the lighter rail icons). `i--fill` fills the shape too.
 */
export function Icon({ name, size = 24, className }: Props) {
  const Svg = ICONS[name];
  return <Svg className={'i' + (className ? ' ' + className : '')} size={size} strokeWidth={2} aria-hidden="true" />;
}
