/**
 * 用户访问权限页（06组织 › 用户访问权限）两个页签共用的展示常量。
 * 授权状态只有两态：有授权 = 已授权，否则未授权。有待处理申请不是一个状态，只是未授权环境上的一个「待处理」标记（同岗位管理「未绑定」旁的「待分配」）。这里只管怎么展示。
 */

/** 员工的完全访问权限状态 → 文案 + StatusTag 类型 */
export const ACCESS_STATE = {
  GRANTED: { label: '已授权', tag: 'success' },
  NONE: { label: '未授权', tag: 'info' }
}

/** 授权来源：管理员直接授权 / 员工申请被通过 */
export const GRANT_SOURCE = {
  ADMIN: '管理员授权',
  REQUEST: '申请通过'
}

/** 权限申请状态 → 文案 + StatusTag 类型 */
export const REQUEST_STATE = {
  PENDING: { label: '待处理', tag: 'warning' },
  APPROVED: { label: '已通过', tag: 'success' },
  REJECTED: { label: '已驳回', tag: 'danger' }
}

/** 驳回原因最多字数（与存储空间拒绝原因、驳回原因、回收原因同口径）；输入框限长，超出无法继续输入 */
export const REJECT_REASON_MAX = 500

/** 运行环境：数字员工有本机（客户端）和云端两个运行环境，完全访问的授权、申请、操作记录都按环境区分 */
export const ENV_LABEL = { LOCAL: '本机', CLOUD: '云端' }

/** 操作记录的运行环境：员工端数字员工所在的运行环境，本机 / 云端各开各的完全访问 */
export const OPERATION_ENV = {
  LOCAL: { label: '本机', tag: 'info' },
  CLOUD: { label: '云端', tag: 'accent' }
}

/**
 * 「完全访问」放开的权限范围：与员工端开启确认框同一组 4 项（名称沿用员工端，desc 是员工端说明改成管理员视角），
 * covers 是其中「原本会弹窗二次确认」的场景，逐条对应客户端《二次确认弹窗清单》第一节 #1–#5（PRD 附录），保证不漏：
 *   #1 删除文件 / 目录 → FILE；#2 危险命令 / 脚本 → COMMAND；#3 浏览器提交类点击 + #4 SOP 回放提交步 → BIZ_SYSTEM；#5 连接器 API 对外写 → NETWORK。
 * 开启后这些场景不再逐次弹「确认执行操作」；desc 里读取、新建等本来就不弹窗，不受授权影响。授权本身仍只有 有 / 没有 两态，不按项拆开。
 */
export const ACCESS_SCOPE = [
  {
    key: 'FILE',
    name: '读写文件',
    desc: '读取、新建、修改、删除员工的文件和文件夹',
    covers: ['删除文件 / 目录（删除后无法恢复）：终端删除命令 rm、rmdir、del、Remove-Item 等，以及脚本里的 shutil.rmtree、os.remove、Path.unlink、send2trash 等删除调用']
  },
  {
    key: 'COMMAND',
    name: '执行命令',
    desc: '运行命令、安装依赖、更改运行环境',
    covers: ['危险命令 / 脚本：命中危险模式的终端命令或脚本，如递归删除、写系统或敏感路径、curl | sh、chmod 777、-e / -c 脚本执行等']
  },
  {
    key: 'BIZ_SYSTEM',
    name: '操作业务系统',
    desc: '替员工在业务系统里提交、保存、发布、审批等操作',
    covers: ['浏览器提交类点击（数据会真实写入业务系统）：点击文字含提交、保存、确认、发送、发布、申请、删除、通过、驳回等的按钮或链接', 'SOP 回放提交步：技能回放执行到提交步骤，口径同上']
  },
  {
    key: 'NETWORK',
    name: '联网与连接器',
    desc: '访问网站、通过已启用的连接器读写外部系统数据',
    covers: ['连接器 API 对外写操作（对外生效）：调用标记了「有副作用」的外部接口']
  }
]

/** 完全访问也放不开的边界：与授权无关，客户端始终照拦 */
export const ACCESS_SCOPE_EXCLUDED = [
  '读取文件、查询数据等本来就不需要确认的操作，没有变化',
  '毁灭级命令（rm -rf /、mkfs、dd 写裸盘、关机重启、fork 炸弹等）、sudo -S 猜密码、命中管理规则（approvals.deny）的命令：客户端始终直接拦截，开了完全访问也不放行；被拦截的会在操作记录里标「已拦截」',
  '员工自己发起的删除 / 卸载确认（删除任务、技能、知识库文件等）：仍照常确认'
]

/** 被客户端直接拦截的命令（毁灭级命令、sudo -S 猜密码、approvals.deny 规则命中）：单独一类，不属于完全访问放开的 4 项权限 */
export const BLOCKED_TYPE = { key: 'HARDLINE', name: '被拦截命令' }

/**
 * 操作记录的权限类型 = 完全访问放开的 4 项（ACCESS_SCOPE 的 key → 名称，免确认执行）+ 单独一类「被拦截命令」（没有执行）。
 * 前 4 项只是完全访问权限里的范围，被拦截命令不在完全访问里，另列一类。
 */
export const OPERATION_TYPE = {
  ...Object.fromEntries(ACCESS_SCOPE.map((item) => [item.key, item.name])),
  [BLOCKED_TYPE.key]: BLOCKED_TYPE.name
}

/**
 * 操作记录里单次操作的结果：免确认放行后可能成功 / 失败；BLOCKED = 客户端直接拦截（毁灭级命令、sudo -S 猜密码、approvals.deny 规则命中，没有弹窗、任何人无权放行），根本没有执行。
 * 被拦截的也记下来，审计能看到有没有人反复尝试危险操作。
 */
export const OPERATION_RESULT = {
  SUCCESS: { label: '成功', tag: 'success' },
  FAILED: { label: '失败', tag: 'danger' },
  BLOCKED: { label: '已拦截', tag: 'warning' }
}
