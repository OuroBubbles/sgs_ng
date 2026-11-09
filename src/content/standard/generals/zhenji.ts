import { general } from '../../../sdk';
import luoshen from '../skills/luoshen';
import qingguo from '../skills/qingguo';

export default general('standard:zhenji', '甄姬', '魏', 3, [luoshen, qingguo], {
  gender: 'female',
});
