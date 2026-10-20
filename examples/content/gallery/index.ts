import { defineGeneral, definePackage } from '@sgs/sdk';
import portrait from '../harbor/guest.jpg';

/** 独立资源包复用另一模块的内容 ID；共享图片仍按普通相对 import 书写。 */
export default definePackage({
  manifest: {
    id: 'gallery',
    name: '画阁',
    version: '0.1.0',
    requires: [{ id: 'harbor', version: '0.1.1' }],
  },
  generals: [
    defineGeneral({
      id: 'gallery:guest',
      name: '画阁客',
      kingdom: '群',
      gender: 'male',
      maxHp: 4,
      skills: ['harbor:tide', 'standard:wusheng'],
    }),
  ],
  generalViews: [{ id: 'gallery:guest', portrait }],
});
