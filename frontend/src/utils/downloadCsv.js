/**
 * 把二维数组导出为 CSV 文件（浏览器端下载，demo 无后端）。
 *
 * - 头部加 BOM（U+FEFF），Excel 打开中文不乱码；
 * - 每个单元格用双引号包裹，内部双引号转义为两个双引号。
 *
 * @param {string} filename 下载文件名
 * @param {string[]} header 表头
 * @param {Array<Array<any>>} body 数据行
 */
export function downloadCsv(filename, header, body) {
  const csv = '﻿' + [header, ...body]
    .map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
