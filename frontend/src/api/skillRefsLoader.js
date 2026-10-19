/**
 * 连接器「被技能引用」反向派生的触发点（待办 yuepu#77）。
 *
 * 引用关系的源头在技能模块（unifiedSkillMock，各技能 SKILL.md「## 引用工具」），它在模块初始化与每次落盘后
 * 把算好的引用清单写进三个连接器 mock（syncSkillRefs）。但技能模块静态依赖连接器模块（工具坞要读连接器行），
 * 连接器这边不能反过来静态 import 技能模块（循环依赖，加载顺序一变就撞 TDZ）。
 * 所以连接器的 list / get 入口（本来就是 async）在读数据前 `await ensureSkillRefs()`：动态 import 一次技能模块，
 * 它初始化时顺带把引用清单灌进连接器。已加载过则是缓存命中，几乎零开销。
 * （同 reviewsMock 对各业务 mock 只用动态 import 的既有做法。）
 */
export const ensureSkillRefs = () => import('./unifiedSkillMock')
