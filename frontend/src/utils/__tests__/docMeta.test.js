import { describe, it, expect, vi } from 'vitest'

// el-icon 组件来自 @element-plus/icons-vue；纯逻辑测试无需真实图标，做轻量 mock
vi.mock('@element-plus/icons-vue', () => ({
  Document: { name: 'Document' },
  Tickets: { name: 'Tickets' },
  Memo: { name: 'Memo' }
}))

const {
  isTerminal,
  mimeIcon,
  fmtSize,
  fmtTime,
  friendlyType,
  friendlyError,
  SOURCE_LABEL,
  STATUS_META
} = await import('@/utils/docMeta')

describe('isTerminal', () => {
  it('parsed / failed 为终态', () => {
    expect(isTerminal('parsed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
  })
  it('pending / parsing / 未知 非终态', () => {
    expect(isTerminal('pending')).toBe(false)
    expect(isTerminal('parsing')).toBe(false)
    expect(isTerminal('')).toBe(false)
    expect(isTerminal(undefined)).toBe(false)
  })
})

describe('mimeIcon', () => {
  it('pdf → cls=pdf', () => {
    expect(mimeIcon('application/pdf').cls).toBe('pdf')
  })
  it('word / msword / officedocument → cls=word', () => {
    expect(mimeIcon('application/msword').cls).toBe('word')
    expect(
      mimeIcon('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .cls
    ).toBe('word')
  })
  it('其余文本（txt/markdown/空）→ cls=text', () => {
    expect(mimeIcon('text/plain').cls).toBe('text')
    expect(mimeIcon('text/markdown').cls).toBe('text')
    expect(mimeIcon('').cls).toBe('text')
    expect(mimeIcon().cls).toBe('text')
  })
  it('大小写不敏感', () => {
    expect(mimeIcon('APPLICATION/PDF').cls).toBe('pdf')
  })
})

describe('fmtSize', () => {
  it('null / undefined → "-"', () => {
    expect(fmtSize(null)).toBe('-')
    expect(fmtSize(undefined)).toBe('-')
  })
  it('小于 1KB → B（整数）', () => {
    expect(fmtSize(0)).toBe('0 B')
    expect(fmtSize(512)).toBe('512 B')
    expect(fmtSize(1023)).toBe('1023 B')
  })
  it('KB 级别保留一位小数', () => {
    expect(fmtSize(1536)).toBe('1.5 KB')
  })
  it('整 KB 也保留一位（i===0 的 KB 档且 <100 → 保留一位）', () => {
    expect(fmtSize(2048)).toBe('2.0 KB')
  })
  it('>=100 单位取整', () => {
    expect(fmtSize(150 * 1024)).toBe('150 KB')
  })
  it('MB / GB 进位', () => {
    expect(fmtSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(fmtSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })
})

describe('friendlyType（mime/扩展名 → 友好类型名，绝不外泄原始 MIME）', () => {
  it('已知映射：pdf / word / markdown / 文本（mime 或扩展名任一命中）', () => {
    expect(friendlyType('application/pdf', '')).toBe('PDF 文档')
    expect(friendlyType('', 'a.pdf')).toBe('PDF 文档')
    expect(friendlyType('application/msword', '')).toBe('Word 文档')
    expect(friendlyType('', 'b.docx')).toBe('Word 文档')
    expect(friendlyType('text/markdown', '')).toBe('Markdown 文档')
    expect(friendlyType('', 'c.md')).toBe('Markdown 文档')
    expect(friendlyType('text/plain', '')).toBe('文本文件')
    expect(friendlyType('', 'd.txt')).toBe('文本文件')
  })
  it('未知 mime/扩展名 → 兜底「文档」，不透出原始串', () => {
    expect(friendlyType('application/octet-stream', 'x.bin')).toBe('文档')
    expect(friendlyType('', '')).toBe('文档')
    expect(friendlyType()).toBe('文档')
  })
})

describe('friendlyError（失败原因人话兜底，错误码/英文堆栈绝不外泄）', () => {
  const GENERIC = '这份文件没能处理成功，请换个文件或稍后重试'
  it('已知情况映射贴心话术（损坏/格式加密/空内容/超时/过大）', () => {
    expect(friendlyError('file corrupt')).toContain('损坏')
    expect(friendlyError('unsupported 格式')).toContain('暂不支持')
    expect(friendlyError('empty content 空白')).toContain('可用内容')
    expect(friendlyError('解析超时')).toContain('超时')
    expect(friendlyError('文件过大')).toContain('太大')
  })
  it('技术串（错误码/英文异常/堆栈/纯英文）→ 一律回退通用人话', () => {
    expect(friendlyError('HTTP 500 Internal Server Error')).toBe(GENERIC)
    expect(friendlyError('NullPointerException at com.x.Y')).toBe(GENERIC)
    expect(friendlyError('something went wrong')).toBe(GENERIC) // 纯英文无中文
  })
  it('空/缺省 → 通用人话；正常中文短句原样展示', () => {
    expect(friendlyError('')).toBe(GENERIC)
    expect(friendlyError(null)).toBe(GENERIC)
    expect(friendlyError(undefined)).toBe(GENERIC)
    expect(friendlyError('这份材料的第三页看不清楚')).toBe('这份材料的第三页看不清楚')
  })
})

describe('fmtTime', () => {
  it('空 → 空串', () => {
    expect(fmtTime('')).toBe('')
    expect(fmtTime(null)).toBe('')
  })
  it('非法时间串 → 原样返回', () => {
    expect(fmtTime('not-a-date')).toBe('not-a-date')
  })
  it('合法 ISO → YYYY-MM-DD HH:mm（按本地时区，故校验格式而非具体值）', () => {
    const out = fmtTime('2026-06-11T08:05:00Z')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('枚举映射口径（契约 §0.1）', () => {
  it('source 全大写', () => {
    expect(Object.keys(SOURCE_LABEL)).toEqual(['UPLOAD', 'CHAT_GENERATED'])
  })
  it('parseStatus 全小写且映射 el-tag type', () => {
    expect(STATUS_META.parsed.tag).toBe('success')
    expect(STATUS_META.failed.tag).toBe('danger')
    expect(Object.keys(STATUS_META)).toEqual([
      'pending',
      'parsing',
      'parsed',
      'failed'
    ])
  })
})
