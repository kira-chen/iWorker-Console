<script setup>
import { ref, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import ThemeToggle from '@/components/ThemeToggle.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref()
const loading = ref(false)
const form = reactive({
  username: '',
  password: ''
})

const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleLogin() {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    loading.value = true
    try {
      await userStore.login({ ...form })
      ElMessage.success('登录成功')
      // 跳转交给路由守卫：未绑定专家会被引导到绑定页，绑定则进入目标/首页。
      // 后台账号（admin / FDE / SYS_CONFIG）无绑定专家，直接落地 /admin，由守卫三路分流到其首页，
      // 避免被绑定判定拦截。用 isBackstage（基于 roles 数组），纯 SYS_CONFIG 也能进后台。
      const redirect = route.query.redirect
      if (redirect) {
        router.replace(String(redirect))
      } else if (userStore.isBackstage) {
        router.replace('/admin')
      } else {
        router.replace('/')
      }
    } catch (e) {
      /* 错误已在拦截器统一提示 */
    } finally {
      loading.value = false
    }
  })
}
</script>

<template>
  <div class="login-page">
    <div class="login-topbar">
      <ThemeToggle />
    </div>

    <div class="login-shell rise-in">
      <!-- 左侧品牌叙事 -->
      <section class="brand-side">
        <div class="hero-row">
          <img class="brand-logo" src="@/assets/images/iworker-logo.png" alt="iWorker" />
          <h1 class="hero-title">
            把事说出口，<br />
            剩下的交给iWorker
          </h1>
        </div>
        <p class="hero-sub">
          一句话发起 · 实时看它怎么办 · 拿到办成的结果
        </p>
        <ul class="feature-list">
          <li><span class="dot"></span>帮你记 · 帮你查 —— 随口一句，自动记进系统、联网查到带来源</li>
          <li><span class="dot"></span>帮你析 · 帮你盯 —— 出评分建议，到点自动跑、结果推回对话</li>
          <li><span class="dot"></span>专属工作搭子，越用越懂你</li>
        </ul>
      </section>

      <!-- 右侧登录卡 -->
      <section class="form-side surface-block">
        <div class="form-head">
          <div class="form-title">欢迎回来</div>
          <div class="form-sub">登录以唤醒你的iWorker</div>
        </div>

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          size="large"
          @keyup.enter="handleLogin"
        >
          <el-form-item label="账号" prop="username">
            <el-input v-model="form.username" placeholder="请输入账号" clearable>
              <template #prefix><el-icon><User /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input
              v-model="form.password"
              type="password"
              placeholder="请输入密码"
              show-password
            >
              <template #prefix><el-icon><Lock /></el-icon></template>
            </el-input>
          </el-form-item>
          <el-form-item>
            <el-button
              type="primary"
              class="login-btn"
              :loading="loading"
              @click="handleLogin"
            >
              <span>进入工作台</span>
            </el-button>
          </el-form-item>
        </el-form>

        <div class="form-foot">企业iWorker平台 · 安全登录</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  /* 登录页专属暖色 hero，恒定不随主题变，字段命名 --lg-* 避免与全局 --c-* 冲突 */
  --lg-bg: linear-gradient(180deg, #fbfbfa 0%, #f5f4f1 45%, #fbfbfa 100%); /* 暖白渐变背景 */
  --lg-grid-line: rgba(55, 53, 47, 0.05); /* 科技网格线（墨黑极淡） */
  --lg-card-top: #37352f; /* 顶部 3px 细条（墨黑，＝ Notion --c-text-strong 同值） */
  --lg-particle: #bcbbb8; /* 上升粒子（暖灰，本页未用粒子，保留备用） */

  position: relative;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--lg-bg);
}
/* 顶部墨黑细条：照搬客户端「登录卡顶细条」意象，落到本页顶部 */
.login-page::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--lg-card-top);
  z-index: var(--z-sticky);
}
/* 极淡科技网格线叠加（轻量、不增交互复杂度） */
.login-page::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(var(--lg-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--lg-grid-line) 1px, transparent 1px);
  background-size: 44px 44px;
}
.login-topbar {
  position: absolute;
  top: var(--space-5);
  right: var(--space-5);
  z-index: calc(var(--z-sticky) + 1);
}

.login-shell {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  gap: var(--space-12);
  width: min(900px, 92vw);
  /* stretch：两栏等高，品牌侧以登录卡高度为基准纵向铺开 */
  align-items: stretch;
}

/* 品牌侧：高度取登录卡的 80%（上下各留 10%），三块内容间隔由 space-between 均分 */
.brand-side {
  align-self: center;
  height: 80%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.hero-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}
.brand-logo {
  width: 128px;
  height: 128px;
  display: block;
  object-fit: contain;
  flex-shrink: 0;
}
.hero-title {
  font-size: var(--fs-2xl);
  line-height: var(--lh-tight);
  color: var(--c-text-strong);
  font-weight: var(--fw-semibold);
}
.hero-sub {
  color: var(--c-text-muted);
  font-size: var(--fs-md);
}
.feature-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.feature-list li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--c-text);
  font-size: var(--fs-base);
}
.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--c-accent);
  flex-shrink: 0;
}

/* 表单侧 */
.form-side {
  padding: var(--space-10) var(--space-8) var(--space-8);
  box-shadow: var(--shadow-md);
}
.form-head {
  margin-bottom: var(--space-6);
}
.form-title {
  font-size: var(--fs-xl);
  font-weight: var(--fw-semibold);
  color: var(--c-text-strong);
}
.form-sub {
  margin-top: var(--space-2);
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}
.login-btn {
  width: 100%;
  font-weight: var(--fw-medium);
}
.form-foot {
  margin-top: var(--space-5);
  text-align: center;
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

:deep(.el-form-item__label) {
  color: var(--c-text-muted);
  font-size: var(--fs-sm);
}

@media (max-width: 820px) {
  .login-shell {
    grid-template-columns: 1fr;
    gap: var(--space-6);
  }
  .brand-side {
    display: none;
  }
}
</style>
