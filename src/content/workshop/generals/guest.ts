import { general } from '../../../sdk';
import wusheng from '../../standard/skills/wusheng';
import hearing from '../skills/hearing';

export default general('workshop:guest', '演武客', '群', 4, [hearing, wusheng]);
