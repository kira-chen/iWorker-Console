<script setup>
/**
 * 后台共享侧边导航栏（自适应宽度竖栏：clamp 150–180px，随窗口缩放，≈160px）。
 *
 * 顶部管理后台名称（iWorker · 管理端）+ 导航项（图标在左、文案在右，左对齐、完整展示）
 * + 底部用户区（头像+名称，点击向上弹出 el-dropdown 二级菜单：用户名 / 外观 / 修改密码 / 退出登录）。
 * 分组标题（岗位管理 / 平台配置 / 平台管理）仍用弱视觉呈现（小字、弱色、左对齐）仅作模块归属提示。
 * AdminLayout 与 PositionWorkbench 共用本组件，从根上保证两处导航视觉/结构一致。
 *
 * 侧栏恒深：自带 --admin-side-* 局部常量（不随浅/暗主题切换），不依赖外层 layout 的变量。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { ref } from 'vue'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'
import ChangePasswordDialog from '@/components/admin/ChangePasswordDialog.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

// 修改密码弹窗（用户菜单入口，普通改密态）
const pwdDialogVisible = ref(false)

const userName = computed(() => userStore.userInfo?.name || '管理员')

// 飞书式窄轨导航（2026-08-21 改版）：六段分组，分组标题带序号（01 总览 / 02 岗位 / …），
// 分组仅作类别归属（无真实页面），组内项才是真实页面。段间小标题 + 分隔。
// - 01 总览：驾驶舱（规划中占位）。三后台角色均可见（总览定位）。
// - 02 岗位：岗位 / 岗位分配 / 岗位技能（原「技能」FDE 入口），随 canFde 显隐。
// - 03 能力：专家 / 平台技能 / 系统内置技能 / 知识库(规划中) / 连接器 / 模型，整段随 canSysConfig 显隐；「模型」仅 ADMIN 逐项收窄。
// - 04 运行：实例与会话 / 运行规格 / 配额与限流（均规划中占位），仅 ADMIN。
// - 05 治理：审核中心(原「发布审核」) / 用户技能审核 / 访问审计(原「登录明细」) / 用户反馈 / 字段字典(原「字段管理」)，均仅 ADMIN。
// - 06 组织：用户 / 角色与权限(原「角色」)，仅 ADMIN。
// 【显隐口径 V102】每项挂 page（页面权限 code，与后端 Module 枚举一一对应），优先按 userStore.hasPage 逐页判定；
// 后端未下发 pages 时（旧 token / 旧响应）退回原口径：roles 派生的 canFde / canSysConfig / isAdmin + item.visible。
// 禁止用单值 role 判权。详见下方 itemVisible。
// 「报表」（FdeReports）本次改版隐藏（路由保留、菜单不列）。
const allGroups = [
  {
    key: 'OVERVIEW',
    no: '01',
    title: '总览',
    // 总览段定位为全后台概览，三后台角色（FDE / SYS_CONFIG / ADMIN）均可见。
    visible: () => userStore.isBackstage,
    items: [
      // 驾驶舱（规划中占位）：点击跳统一「功能开发中」占位页并高亮。
      { index: 'AdminCockpit', label: '驾驶舱', icon: 'Odometer', page: 'OVERVIEW_COCKPIT' }
    ]
  },
  {
    key: 'POSITION',
    no: '02',
    title: '岗位',
    visible: () => userStore.canFde,
    items: [
      { index: 'AdminPositions', label: '岗位', icon: 'Avatar', page: 'POSITION_LIST' },
      // 岗位分配（提案 20260721-2）：以用户为核心设置用户绑定的岗位。图标用 Switch（换绑语义），与「岗位」Avatar 区分。
      { index: 'AdminPositionAssignments', label: '岗位分配', icon: 'Switch', page: 'POSITION_ASSIGNMENT' }
      // 注：原「岗位技能」项已随技能三页合一下线（2026-08-23），并入 03 能力段的「技能」页。
    ]
  },
  {
    key: 'CAPABILITY',
    no: '03',
    title: '能力',
    visible: () => userStore.canSysConfig,
    items: [
      // 「专家」（V81）：把多个平台技能归类整合成可交付单元。只引用平台技能，与 FDE 技能隔离。
      // 与岗位段的「岗位」是两回事，图标特意用 Star 而非 Avatar 以免混淆。
      { index: 'AdminExperts', label: '专家', icon: 'Star', page: 'CAPABILITY_EXPERT' },
      // 「技能」（三页合一，2026-08-23）：岗位私有 / 平台共享 / 系统内置 三类统一管理，
      // 取代原「岗位技能 / 平台技能 / 系统内置技能」三个入口。
      // 不再按 isAdmin 逐项收窄——可见性交由页面权限 CAPABILITY_SKILL_CONSOLE 治理，
      // 由管理员在角色页决定授予谁（否则三页下线后，非 ADMIN 角色将完全没有技能入口）。
      { index: 'AdminSkillsUnified', label: '技能', icon: 'List', page: 'CAPABILITY_SKILL_CONSOLE' },
      // 知识库（规划中占位）：点击跳统一「功能开发中」占位页并高亮。
      { index: 'AdminKnowledgeBase', label: '知识库', icon: 'Collection', page: 'CAPABILITY_KNOWLEDGE_BASE' },
      { index: 'AdminConnector', label: '连接器', icon: 'Connection', page: 'CAPABILITY_CONNECTOR' },
      // 「模型」（V76）：OpenAI 协议模型接入/验证/发布审核，仅 ADMIN。
      // 整段随 canSysConfig 显示，模型项自身再按 isAdmin 收窄（纯 SYS_CONFIG 不显本项）。
      { index: 'AdminModels', label: '模型', icon: 'Cpu', page: 'CAPABILITY_MODEL', visible: () => userStore.isAdmin }
    ]
  },
  {
    key: 'RUNTIME',
    no: '04',
    title: '运行',
    // 运行治理段均为规划中占位，仅 ADMIN 可见（与治理/组织门槛一致）。
    visible: () => userStore.isAdmin,
    items: [
      // 以下三项均为规划中占位，点击跳统一「功能开发中」占位页并高亮。
      { index: 'AdminInstances', label: '实例与会话', icon: 'Monitor', page: 'RUNTIME_INSTANCE' },
      { index: 'AdminRuntimeSpecs', label: '运行规格', icon: 'SetUp', page: 'RUNTIME_SPEC' },
      { index: 'AdminQuotaThrottle', label: '配额与限流', icon: 'Histogram', page: 'RUNTIME_QUOTA' }
    ]
  },
  {
    key: 'GOVERNANCE',
    no: '05',
    title: '治理',
    visible: () => userStore.isAdmin,
    items: [
      // 我的申请（2026-09-01 PRD 对齐新增）：查看和跟踪自己提交的审核申请，列于审核中心之前。
      { index: 'AdminMyApplications', label: '我的申请', icon: 'Tickets', page: 'GOVERNANCE_MY_APPLICATION' },
      // 审核中心（原「发布审核」UnifiedReview，工具+技能统一审核台）。
      { index: 'UnifiedReview', label: '审核中心', icon: 'Checked', page: 'GOVERNANCE_REVIEW_CENTER' },
      // 用户技能审核（V94）：客户端用户提交的技能审核（自用/平台共享），admin 审核（通过/不通过）。
      { index: 'SysConfigUserSkillReviews', label: '用户技能审核', icon: 'Upload', page: 'GOVERNANCE_USER_SKILL_REVIEW' },
      // 访问审计（原「登录明细」，S4 客户端会谈 R2）：用户登录/登出记录。
      { index: 'AdminLoginLogs', label: '访问审计', icon: 'DocumentCopy', page: 'GOVERNANCE_ACCESS_AUDIT' },
      // 用户反馈（V80）：客户端意见反馈只读列表。
      { index: 'AdminFeedback', label: '用户反馈', icon: 'ChatLineSquare', page: 'GOVERNANCE_FEEDBACK' },
      // 字段字典（原「字段管理」V94）：统一字段字典管理中心（技能分类 / 风险类型 / 风险等级……）。
      { index: 'SysConfigFieldManagement', label: '字段字典', icon: 'Grid', page: 'GOVERNANCE_FIELD_DICT' }
    ]
  },
  {
    key: 'ORGANIZATION',
    no: '06',
    title: '组织',
    visible: () => userStore.isAdmin,
    items: [
      { index: 'AdminUsers', label: '用户', icon: 'User', page: 'ORGANIZATION_USER' },
      // 角色与权限（原「角色」）。
      { index: 'AdminRoles', label: '角色与权限', icon: 'Key', page: 'ORGANIZATION_ROLE' }
    ]
  }
]

/**
 * 逐项显隐判定（V102 角色与权限改造）。
 *
 * 【优先级】页面权限（item.page）> 原角色判定（段 visible + item.visible）。
 * 后端 /auth/me 下发 user.pages 后，菜单按「这个角色开没开这一页」逐项显示；
 * hasPage 返回 null 表示后端没给 pages（旧 token / 旧响应），此时**整体退回原角色判定**，
 * 保证老会话不被锁在门外——这是向下兼容的关键分支，勿删。
 *
 * 【分组】某段所有项都不可见时整段隐藏（不再单看段级 visible），
 * 避免出现「有段标题、段内空无一物」的空壳分组。
 */
function itemVisible(group, item) {
  const byPage = item.page ? userStore.hasPage(item.page) : null
  if (byPage !== null) return byPage
  // 无页面数据 → 退回原角色判定（段门 + 项门叠加）
  return group.visible() && (item.visible ? item.visible() : true)
}

const groups = computed(() =>
  allGroups
    .map((g) => ({ ...g, items: g.items.filter((m) => itemVisible(g, m)) }))
    .filter((g) => g.items.length)
)

// 当前高亮项：容器子页 / 工作台等用 meta.activeMenu 归并到对应一级项。
const activeMenu = computed(() => route.meta.activeMenu || route.name)

function go(name) {
  if (name !== route.name) router.push({ name })
}

// 头像二级菜单：按 command 分发（当前仅退出登录）。
// 外观切换不走 command（ThemeToggle 自带点击），单独包 stop 容器。
async function onUserCommand(command) {
  if (command === 'changePassword') {
    pwdDialogVisible.value = true
    return
  }
  if (command === 'logout') {
    try {
      await ElMessageBox.confirm('确认退出登录？', '提示', { type: 'warning' })
      // logout() 内部已集中清 token+用户信息+重置 position/chat store
      userStore.logout()
      router.replace({ name: 'Login' })
    } catch (e) {
      /* 取消 */
    }
  }
}
</script>

<template>
  <!-- 侧栏：顶部管理后台名称 + 导航项（图标在左、文案在右，左对齐完整展示）+ 底部用户（头像+名称，二级菜单） -->
  <aside class="rail">
    <div class="rail-brand" title="iWorker · 管理端">
      <img class="rail-brand-logo" src="@/assets/images/iworker-logo.png" alt="" />
      <span class="rail-brand-text">iWorker · 管理端</span>
    </div>

    <nav class="rail-nav">
      <!-- 三段分组：每段小标题 + 段内菜单；段按角色显隐（groups 已过滤） -->
      <div
        v-for="g in groups"
        :key="g.key"
        class="rail-group"
      >
        <div class="rail-group-title" :title="g.title">
          <span v-if="g.no" class="rail-group-no">{{ g.no }}</span>
          <span class="rail-group-name">{{ g.title }}</span>
        </div>
        <button
          v-for="m in g.items"
          :key="m.index"
          type="button"
          class="rail-item"
          :class="{ 'is-active': activeMenu === m.index }"
          @click="go(m.index)"
        >
          <span class="rail-ic">
            <el-icon><component :is="m.icon" /></el-icon>
          </span>
          <span class="rail-label">{{ m.label }}</span>
        </button>
      </div>
    </nav>

    <!-- 底部用户区（参考样例）：头像+名称一行，点击向上弹出用户菜单（外观/修改密码/退出登录） -->
    <div class="rail-foot">
      <el-dropdown
        trigger="click"
        placement="top-start"
        popper-class="rail-user-popper"
        @command="onUserCommand"
      >
        <button type="button" class="rail-user" :title="userName">
          <el-avatar :size="28" class="rail-avatar">{{ userName[0] }}</el-avatar>
          <span class="rail-user-label">{{ userName }}</span>
        </button>
        <template #dropdown>
          <el-dropdown-menu class="rail-user-menu">
            <div class="rail-user-name">{{ userName }}</div>
            <!-- ThemeToggle 自带点击切主题：包一层并 stop，避免被 dropdown command 吞掉/收起 -->
            <div class="rail-theme-row" @click.stop>
              <span class="rail-theme-label">外观</span>
              <ThemeToggle />
            </div>
            <el-dropdown-item command="changePassword" divided>
              <el-icon><Lock /></el-icon> 修改密码
            </el-dropdown-item>
            <el-dropdown-item command="logout">
              <el-icon><SwitchButton /></el-icon> 退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- 修改密码弹窗（普通改密态，可关闭）：入口在底部用户二级菜单 -->
    <ChangePasswordDialog v-model:visible="pwdDialogVisible" />
  </aside>
</template>

<style scoped>
/* ---- 窄轨（后台专属深色，恒定，不随浅/暗主题切换；与浅色员工端形成强场景区分）---- */
.rail {
  /* 后台专属深色（原型 #2b2a28 系），不引 tokens：刻意与员工端区分 */
  --admin-side-bg: #2b2a28;
  --admin-side-text: rgba(255, 255, 255, 0.7);
  --admin-side-text-strong: #ffffff;
  --admin-side-hover: rgba(255, 255, 255, 0.1);
  --admin-side-active: rgba(255, 255, 255, 0.2);
  --admin-side-accent: #ffffff;
  /* 恒定深色背景上的「即将上线」固定亮橙：不随浅/暗主题变化，保证始终醒目 */
  --admin-side-warning: #f0a93b;
  /* 头像恒定底色：沿用浅色主题 accent 原值，不随浅/暗主题变化，避免恒深轨上出现唯一变色元素 */
  --admin-side-avatar: #059669;
  --admin-side-line: rgba(255, 255, 255, 0.1);
  /* 分组小标题字号：弱视觉小字（略小于 --fs-xs），提为局部常量与其它 --admin-side-* 自洽 */
  --admin-side-fs-group: 10px;

  /* 自适应宽度：随窗口宽连续缩放，下限 150px（保菜单文案完整）、上限 180px（不过宽）；
     约 1333px 窗口时 ≈160px。纯 CSS clamp，无需 JS 监听 resize。 */
  width: clamp(150px, 12vw, 180px);
  flex-shrink: 0;
  background: var(--admin-side-bg);
  border-right: 1px solid var(--admin-side-line);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: var(--space-2) 0;
  gap: var(--space-2);
}

/* 顶部管理后台名称（左对齐，与导航项文字列对齐；高度对齐原头像位，避免整轨节奏变化） */
.rail-brand {
  padding: 0 var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 14px;
  font-weight: var(--fw-semibold);
  line-height: 30px;
  color: var(--admin-side-text-strong);
  white-space: nowrap;
  overflow: hidden;
}
.rail-brand-logo {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}
.rail-brand-text {
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 底部用户区：分隔线区隔导航与用户行 */
.rail-foot {
  padding: var(--space-2) var(--space-2) 0;
  border-top: 1px solid var(--admin-side-line);
}
.rail-foot .el-dropdown {
  width: 100%;
}
/* 用户行：头像在左、名称在右，整行可点（弹出用户菜单），悬停高亮与导航项同语言 */
.rail-user {
  border: none;
  background: transparent;
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-2);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--admin-side-text);
  outline: none;
  transition: background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.rail-user:hover {
  background: var(--admin-side-hover);
  color: var(--admin-side-text-strong);
}
.rail-avatar {
  flex-shrink: 0;
  background: var(--admin-side-avatar);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  cursor: pointer;
}
.rail-user-label {
  font-size: 13px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 名称下分隔线，弱化区隔品牌与导航 */
.rail-nav {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2) var(--space-2) 0;
  margin-top: var(--space-1);
  border-top: 1px solid var(--admin-side-line);
  /* 导航组随功能增多已超短窗口高度：轨内自滚动，禁止整轨被 100vh 布局裁掉底部项。
     滚动条隐藏（窄轨美学，飞书同款口径），滚轮/触板照常可滚。 */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}
.rail-nav::-webkit-scrollbar {
  display: none;
}

/* 模块分组：段内菜单纵向排列；非首段顶部加分隔线区隔两模块 */
.rail-group {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
.rail-group + .rail-group {
  padding-top: var(--space-2);
  border-top: 1px solid var(--admin-side-line);
}
/* 分组小标题：弱视觉呈现（小字、弱色、左对齐），仅作类别归属提示，不与菜单项争视觉重量。
   带序号（01/02…）：序号在左、类别名在右，序号用等宽数字 + 略强对比以呼应截图分段编号语义。 */
.rail-group-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  font-size: var(--admin-side-fs-group);
  line-height: 1.2;
  text-align: left;
  color: var(--admin-side-text);
  opacity: 0.5;
  letter-spacing: 0.04em;
  padding: 0 var(--space-3);
  margin-bottom: 1px;
  white-space: nowrap;
  overflow: hidden;
}
.rail-group-no {
  font-variant-numeric: tabular-nums;
  font-weight: var(--fw-semibold);
  flex-shrink: 0;
}
.rail-group-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 导航项：图标在左、文案在右、左对齐，宽栏下文案完整展示 */
.rail-item {
  position: relative;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  padding: 5px var(--space-3);
  border-radius: var(--radius-md);
  color: var(--admin-side-text);
  transition: background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}
.rail-item:hover {
  color: var(--admin-side-text-strong);
  background: var(--admin-side-hover);
}
.rail-item.is-active {
  color: var(--admin-side-text-strong);
  background: var(--admin-side-active);
}
/* 选中项左侧 accent 竖条：让「我在这一项」一眼可辨 */
.rail-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 18px;
  border-radius: 0 var(--radius-pill) var(--radius-pill) 0;
  background: var(--admin-side-accent);
}
.rail-ic {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  font-size: 16px;
  line-height: 1;
}
.rail-label {
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

<!-- 头像下拉非 scoped（popper teleport 到 body，scoped 选择器命不中） -->
<style>
.rail-user-popper .rail-user-name {
  padding: var(--space-2) var(--space-4) var(--space-1);
  font-size: var(--fs-sm);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.rail-user-popper .rail-theme-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-4);
}
.rail-user-popper .rail-theme-label {
  font-size: var(--fs-base);
  color: var(--c-text);
}
</style>
