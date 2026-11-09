import { general } from '../../../sdk';
import wusheng from '../../standard/skills/wusheng';
import vermilion from '../skills/vermilion';

export default general('workshop:vermilion_guest', '绯衣客', '群', 3, [vermilion, wusheng], {
  gender: 'female',
});
