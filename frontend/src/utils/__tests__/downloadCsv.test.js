// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadCsv } from '../downloadCsv'

describe('downloadCsv', () => {
  let blobs
  let clicked

  beforeEach(() => {
    blobs = []
    clicked = []
    globalThis.URL.createObjectURL = vi.fn((b) => {
      blobs.push(b)
      return 'blob:mock/1'
    })
    globalThis.URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicked.push({ href: this.href, download: this.download })
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete globalThis.URL.createObjectURL
    delete globalThis.URL.revokeObjectURL
  })

  it('触发一次下载，文件名原样使用', () => {
    downloadCsv('a.csv', ['列'], [['值']])
    expect(clicked).toEqual([{ href: 'blob:mock/1', download: 'a.csv' }])
  })

  it('带 BOM（Excel 中文不乱码）；单元格双引号包裹，内部双引号转义；null / undefined 输出空串；行间 CRLF', async () => {
    downloadCsv('a.csv', ['名称', '备注'], [['他说"好"', null], ['a,b', undefined], [0, '']])
    // Blob.text() 会自动剥掉 BOM，所以 BOM 要看原始字节：UTF-8 的 U+FEFF 是 EF BB BF
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(await blobs[0].text()).toBe('"名称","备注"\r\n"他说""好""",""\r\n"a,b",""\r\n"0",""')
  })
})
