import { describe, it, expect } from 'vitest'
import {
  splitTextToToolRefNodes,
  toolRefToMarkdown,
  toolRefNode,
  normalizeToolRefs,
  resolveBizName,
  TOOL_INLINE_RE,
  TOOL_BLOCK_RE
} from '@/utils/skillToolRef'

describe('skillToolRef · 纯逻辑（mdast 切分 / 序列化 / round-trip）', () => {
  describe('splitTextToToolRefNodes —— 文本切成 text/toolRef 节点序列', () => {
    it('无任何标记 → 返回 null（保持原 text 节点不动）', () => {
      expect(splitTextToToolRefNodes('普通散文，无工具引用')).toBeNull()
      expect(splitTextToToolRefNodes('')).toBeNull()
      expect(splitTextToToolRefNodes(null)).toBeNull()
    })

    it('单个行内 @tool[code] → 单个 toolRef 节点', () => {
      expect(splitTextToToolRefNodes('@tool[weather]')).toEqual([toolRefNode('weather')])
    })

    it('单个块级 :::tool{code=x}（独占行）→ 单个 toolRef 节点', () => {
      expect(splitTextToToolRefNodes(':::tool{code=weather}')).toEqual([toolRefNode('weather')])
    })

    it('块级允许内部空格', () => {
      expect(splitTextToToolRefNodes(':::tool{ code = my_tool_2 }')).toEqual([
        toolRefNode('my_tool_2')
      ])
    })

    it('散文 + chip 混排 → text/toolRef 交替，不产生空 text 节点', () => {
      expect(splitTextToToolRefNodes('先 @tool[a] 再 @tool[b] 结束')).toEqual([
        { type: 'text', value: '先 ' },
        toolRefNode('a'),
        { type: 'text', value: ' 再 ' },
        toolRefNode('b'),
        { type: 'text', value: ' 结束' }
      ])
    })

    it('相邻两 chip 之间无散文 → 不插入空 text 节点', () => {
      expect(splitTextToToolRefNodes('@tool[a]@tool[b]')).toEqual([
        toolRefNode('a'),
        toolRefNode('b')
      ])
    })

    it('行内 + 块级两种写法混排都识别', () => {
      expect(splitTextToToolRefNodes('@tool[a] 和 :::tool{code=b}')).toEqual([
        toolRefNode('a'),
        { type: 'text', value: ' 和 ' },
        toolRefNode('b')
      ])
    })

    it('code 字符集与后端一致 [a-z][a-z0-9_]*（小写起头 + 下划线/数字）', () => {
      expect(splitTextToToolRefNodes('@tool[table__ke_hu__query]')).toEqual([
        toolRefNode('table__ke_hu__query')
      ])
      expect(splitTextToToolRefNodes('@tool[biz__crm2]')).toEqual([toolRefNode('biz__crm2')])
    })

    it('非法 code（大写/冒号/点/连字符/数字开头）不识别为 chip，按散文保留（与后端口径一致，CR-P1）', () => {
      // 后端 SkillMdToolParser 正则 ^[a-z][a-z0-9_]* 不认这些 → 前端也不得转 chip，否则白名单不收
      expect(splitTextToToolRefNodes('@tool[GetWeather]')).toBeNull()
      expect(splitTextToToolRefNodes('@tool[ns:tool]')).toBeNull()
      expect(splitTextToToolRefNodes('@tool[a-b]')).toBeNull()
      expect(splitTextToToolRefNodes('@tool[2fa]')).toBeNull()
    })

    it('占位符 {{intake.key}} 不被误吞，作为散文保留', () => {
      expect(splitTextToToolRefNodes('查 {{intake.city}} 的 @tool[weather]')).toEqual([
        { type: 'text', value: '查 {{intake.city}} 的 ' },
        toolRefNode('weather')
      ])
    })
  })

  describe('toolRefToMarkdown —— 节点写回收敛形态', () => {
    it('统一写回行内 @tool[code]', () => {
      expect(toolRefToMarkdown('weather')).toBe('@tool[weather]')
      expect(toolRefToMarkdown('ns:t-1.0')).toBe('@tool[ns:t-1.0]')
    })
  })

  describe('round-trip（normalizeToolRefs）—— 解析→序列化归一，不丢内容', () => {
    it('@tool[x] → @tool[x]（行内幂等）', () => {
      expect(normalizeToolRefs('@tool[x]')).toBe('@tool[x]')
    })

    it(':::tool{code=x}（独占行）→ @tool[x]（块级归一为行内）', () => {
      expect(normalizeToolRefs(':::tool{code=x}')).toBe('@tool[x]')
    })

    it('块级带空格 → 归一为行内紧凑形态', () => {
      expect(normalizeToolRefs(':::tool{ code = x }')).toBe('@tool[x]')
    })

    it('混排（散文 + chip + 占位符）round-trip 内容完整、chip 归一', () => {
      const input = '步骤一：查 {{intake.city}} 天气 @tool[weather]，再 :::tool{code=notify} 通知用户。'
      const expected = '步骤一：查 {{intake.city}} 天气 @tool[weather]，再 @tool[notify] 通知用户。'
      expect(normalizeToolRefs(input)).toBe(expected)
    })

    it('多行文本逐处归一，散文与换行保留', () => {
      const input = ['# 标题', '调用 @tool[a]', ':::tool{code=b}', '结束 {{intake.k}}'].join('\n')
      const expected = ['# 标题', '调用 @tool[a]', '@tool[b]', '结束 {{intake.k}}'].join('\n')
      expect(normalizeToolRefs(input)).toBe(expected)
    })

    it('二次归一幂等（已归一文本再跑一次不变）', () => {
      const once = normalizeToolRefs('a @tool[x] :::tool{code=y} b')
      expect(normalizeToolRefs(once)).toBe(once)
    })

    it('无引用文本原样返回', () => {
      const txt = '完全没有工具引用的一段话 {{intake.name}}'
      expect(normalizeToolRefs(txt)).toBe(txt)
    })
  })

  describe('resolveBizName —— chip 业务名解析优先级（防退化成 code）', () => {
    const TABLE_CODE = 'table__ke_hu_jiao_hu_ji_lu_biao__create'

    it('节点 attr 上的 bizName 最优先（刚插入时）', () => {
      expect(
        resolveBizName(TABLE_CODE, '客户交互记录表 · 新增', { [TABLE_CODE]: '别的名' }, { [TABLE_CODE]: '又别的' })
      ).toBe('客户交互记录表 · 新增')
    })

    it('attr 缺失 → 用持久回显映射 toolNames（保存+重载后稳定）', () => {
      expect(resolveBizName(TABLE_CODE, '', { [TABLE_CODE]: '客户交互记录表 · 新增' }, {})).toBe(
        '客户交互记录表 · 新增'
      )
    })

    it('attr 与 toolNames 都缺失 → 用本会话插入映射兜底（保存前不退化）', () => {
      expect(resolveBizName(TABLE_CODE, '', {}, { [TABLE_CODE]: '客户交互记录表 · 新增' })).toBe(
        '客户交互记录表 · 新增'
      )
    })

    it('toolNames 优先于本会话映射（持久回显比会话兜底更权威）', () => {
      expect(
        resolveBizName(TABLE_CODE, '', { [TABLE_CODE]: '持久名' }, { [TABLE_CODE]: '会话名' })
      ).toBe('持久名')
    })

    it('三处都没有 → 回落 code（绝不报错）', () => {
      expect(resolveBizName(TABLE_CODE, '', {}, {})).toBe(TABLE_CODE)
      expect(resolveBizName(TABLE_CODE, undefined, undefined, undefined)).toBe(TABLE_CODE)
    })

    it('空字符串业务名不被采纳（按缺失处理，继续向下回落）', () => {
      expect(resolveBizName(TABLE_CODE, '', { [TABLE_CODE]: '' }, { [TABLE_CODE]: '会话名' })).toBe(
        '会话名'
      )
    })

    it('残留会话名不影响已有 toolNames（同 code 时持久回显胜出，不被旧会话名污染）', () => {
      // 语义用例：技能 A 会话里 code→「A 的名」残留在 session，技能 B 的 toolNames 已含同 code 的「B 的名」。
      // resolveBizName 优先 toolNames，故 B 不会误显 A 的会话名（即便 resetSession 漏调也由优先级兜一层）。
      const sessionFromA = { [TABLE_CODE]: 'A 技能里的名' }
      const toolNamesOfB = { [TABLE_CODE]: 'B 技能里的名' }
      expect(resolveBizName(TABLE_CODE, '', toolNamesOfB, sessionFromA)).toBe('B 技能里的名')
    })
  })

  /**
   * 会话隔离（CR-P1）：模拟 Core 的「实例级 sessionBizNames + resetSession 重建」行为。
   * Core 切技能时编辑器子树实例复用、不重建，故必须主动 resetSession 清空会话名，
   * 否则技能 A 插入的名会残留到技能 B（B 引同 code 且 referencedTools 尚未刷新的瞬间会误显）。
   * 这里用与 Core 等价的最小模型（普通对象 + 重建）断言「切技能即清、不再跨技能影响」。
   */
  describe('会话隔离 —— insertTool 写入 sessionBizNames → 切技能 resetSession → 映射已清', () => {
    const CODE_A = 'tool_alpha'
    const CODE_B = 'tool_beta'

    // 等价复刻 Core：let 绑定的会话映射 + 写入 + 重建（resetSession）。
    function makeSession() {
      let map = Object.create(null)
      return {
        insert: (code, biz) => {
          if (biz) map[code] = biz
        },
        reset: () => {
          map = Object.create(null)
        },
        // 解析时读「当前绑定」，等价 Core 的 bizNameOf(code, attr) 经 resolveBizName 读 sessionBizNames。
        resolve: (code, attrBiz, toolNames) => resolveBizName(code, attrBiz, toolNames, map)
      }
    }

    it('同技能内：插入后重解析（attr 丢失）仍由会话映射显业务名，不退化成 code', () => {
      const s = makeSession()
      s.insert(CODE_A, '客户交互记录表 · 新增')
      // 模拟 replaceAll 重解析后 attr 为空、toolNames 尚未刷新
      expect(s.resolve(CODE_A, '', {})).toBe('客户交互记录表 · 新增')
    })

    it('切技能：resetSession 后技能 A 的会话名不再残留，B 的同 code 解析回落 code（不误显 A 名）', () => {
      const s = makeSession()
      s.insert(CODE_A, 'A 技能：导出报表')
      expect(s.resolve(CODE_A, '', {})).toBe('A 技能：导出报表')

      // 切到技能 B：上层 watch(skillId) 调 resetSession
      s.reset()

      // B 也引用了同一 code，但其 referencedTools 尚未刷新（toolNames 暂空）。
      // 会话名已清 → 回落 code，绝不误显 A 的会话名（会话隔离达成）。
      expect(s.resolve(CODE_A, '', {})).toBe(CODE_A)
    })

    it('切技能后冷重载：靠 toolNames(referencedTools) 兜底显业务名，不依赖已清的会话映射', () => {
      const s = makeSession()
      s.insert(CODE_A, '旧会话名')
      s.reset() // 切技能清空
      // 技能 B 的 referencedTools 刷新到位（toolNames 含 B 的名）→ 正常显业务名
      expect(s.resolve(CODE_B, '', { [CODE_B]: '新建工单' })).toBe('新建工单')
    })
  })

  describe('正则导出与口径一致性', () => {
    it('TOOL_INLINE_RE 匹配 @tool[code]', () => {
      expect(TOOL_INLINE_RE.test('@tool[abc]')).toBe(true)
      expect(TOOL_INLINE_RE.test('@tool[]')).toBe(false)
    })
    it('TOOL_BLOCK_RE 匹配 :::tool{code=x}', () => {
      expect(TOOL_BLOCK_RE.test(':::tool{code=x}')).toBe(true)
      expect(TOOL_BLOCK_RE.test(':::tool{ code = x }')).toBe(true)
    })
  })
})
