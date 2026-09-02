<script setup>
/**
 * 用户技能审核 · 技能详情页（V94，只读预览 + 审核）。
 *
 * 复用 SkillFocusEditor（与平台技能详情页同一组件、同视觉），传 :readonly + :review-mode：
 * - 右栏改「客户端安全检测结果（默认展开）+ 工具引用（收起联动）」手风琴——进页即见安全检测结果；
 * - 顶栏「保存配置」换「审核」按钮 → 开审核弹窗（结果单选 + 意见），复用列表页同一审核逻辑；
 * - 技能标签/分类、示例问题、触发词、描述、skill.md 均只读展示（readonly 态既有能力）。
 *
 * 数据源：审核申请（非 skill 行）。详情走 /fde/user-skill-reviews/{id}（风险项+申请信息），
 * 文件树/内容走 skillFiles.js 的 source='review'（即时解析留档 zip，不落库）。
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import AdminRail from '@/components/admin/AdminRail.vue'
import SkillFocusEditor from '@/components/position/SkillFocusEditor.vue'
import { listSkillFiles, getSkillFile } from '@/api/skillFiles'
import { getReviewApplication, reviewApplication } from '@/api/skillReview'
import { ENTRY_PATH } from '@/utils/skillFileTree'

const route = useRoute()
const router = useRouter()
const reviewId = computed(() => route.params.id)

const skill = ref(null)
const loading = ref(false)
const loadError = ref(false)
const riskItems = ref([])
const reviewStatus = ref('')

const files = ref([])
const treeLoading = ref(false)
const treeLoadError = ref(false)
const activeFilePath = ref(ENTRY_PATH)
const contentCache = reactive({})

const activeFileType = computed(() => {
  const p = activeFilePath.value
  const i = p.lastIndexOf('.')
  return i > 0 ? p.slice(i + 1).toLowerCase() : 'md'
})
const activeFileContent = computed(() => {
  if (activeFilePath.value === ENTRY_PATH) return skill.value?.skillMd || ''
  return contentCache[activeFilePath.value] ?? ''
})

async function load() {
  loading.value = true
  loadError.value = false
  treeLoading.value = true
  try {
    const d = await getReviewApplication(reviewId.value)
    riskItems.value = d?.riskItems || []
    reviewStatus.value = d?.reviewStatus || ''
    // 合成一个只读 skill 对象喂给编辑器（正文由 SKILL.md 文件内容回填）。
    skill.value = {
      skillId: reviewId.value,
      name: d?.skillName || '',
      description: d?.skillDescription || '',
      triggers: [],
      exampleQuestion: '',
      defaultInstall: false,
      skillMd: '',
      referencedTools: [],
      category: null,
      displayCategoryId: null
    }
    // 文件树 + 入口 SKILL.md 内容。
    try {
      const tree = await listSkillFiles(reviewId.value, 'review')
      files.value = tree?.files || []
      const entry = await getSkillFile(reviewId.value, ENTRY_PATH, 'review')
      skill.value = { ...skill.value, skillMd: entry?.content || '' }
    } catch (e) {
      treeLoadError.value = true
    } finally {
      treeLoading.value = false
    }
  } catch (e) {
    loadError.value = true
    treeLoading.value = false
  } finally {
    loading.value = false
  }
}

async function onSelectFile(path) {
  if (path === activeFilePath.value) return
  activeFilePath.value = path
  if (path === ENTRY_PATH) return
  if (contentCache[path] === undefined) {
    try {
      const vo = await getSkillFile(reviewId.value, path, 'review')
      contentCache[path] = vo?.content ?? ''
    } catch (e) {
      contentCache[path] = ''
    }
  }
}

function backToList() {
  router.push({ name: 'SysConfigUserSkillReviews' })
}

/* -------- 审核弹窗（复用列表页同一提交逻辑） -------- */
const reviewVisible = ref(false)
const reviewing = ref(false)
const reviewForm = reactive({ approved: true, comment: '' })
function openReview() {
  reviewForm.approved = true
  reviewForm.comment = ''
  reviewVisible.value = true
}
async function submitReview() {
  reviewing.value = true
  try {
    await reviewApplication(reviewId.value, {
      approved: reviewForm.approved,
      comment: reviewForm.comment || undefined
    })
    ElMessage.success(reviewForm.approved ? '已通过审核' : '已拒绝')
    reviewVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '审核失败，请重试')
  } finally {
    reviewing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="se-shell">
    <AdminRail />
    <div class="se-container">
      <div class="se-stage">
        <SkillFocusEditor
          :skill="skill"
          :loading="loading"
          :load-error="loadError"
          :show-close="false"
          :readonly="true"
          :review-mode="true"
          :risk-items="riskItems"
          back-label="← 返回"
          skill-source="review"
          :files="files"
          :active-file-path="activeFilePath"
          :active-file-type="activeFileType"
          :active-editable="false"
          :active-file-content="activeFileContent"
          :tree-loading="treeLoading"
          :tree-load-error="treeLoadError"
          @back="backToList"
          @close="backToList"
          @retry="load"
          @select-file="onSelectFile"
          @review="openReview"
        />
      </div>
    </div>

    <!-- 审核弹窗（与列表页同款） -->
    <el-dialog v-model="reviewVisible" title="技能审核" width="440px" :close-on-click-modal="false">
      <p class="rd-hint">请根据技能内容与客户端上报的风险项给出审核结论。通过后「平台共享」技能将进入平台技能列表。</p>
      <el-form label-position="top">
        <el-form-item label="审核结果" required>
          <el-radio-group v-model="reviewForm.approved">
            <el-radio :value="true">通过</el-radio>
            <el-radio :value="false">不通过</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="审核意见">
          <el-input
            v-model="reviewForm.comment"
            type="textarea"
            :rows="4"
            maxlength="2000"
            show-word-limit
            placeholder="填写审核意见（拒绝时建议说明原因，客户端可回查看到）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewVisible = false">取消</el-button>
        <el-button type="primary" :loading="reviewing" @click="submitReview">提交审核</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.se-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-app);
}
.se-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.se-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 0;
  background: var(--bg-app);
}
.rd-hint {
  font-size: 13px;
  color: var(--c-text-muted);
  margin: 0 0 16px;
  line-height: 1.6;
}
</style>
