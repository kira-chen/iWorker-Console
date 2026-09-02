# Element Plus 颜色 Token 改造对照表

> iWorker 管理后台 · 设计规范改造
> 基准版本：Element Plus 2.9.1（theme-chalk）
> 色值来源：iWorker 色彩规范（主题色&功能色 / 中性色）

## 使用说明

- **Element 变量**：需要在系统里改造的 Element 原生 CSS 变量
- **修改后色值**：改造后应填入的确定值，可直接复制
- 共 **71** 个变量需手动修改，另有 **11** 个由 Element 源码内部 var() 引用，改完前者会自动跟随
- 覆盖样式需在引入 element-plus 之后加载，否则不生效

---

## 品牌主色 Primary

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-color-primary-light-9` | `#EBF1FF` | 最浅背景填充 · Menu hover 底、选中行底 |
| `--el-color-primary-light-8` | `#D3E1FF` | 浅背景悬浮态 · Tag 浅底 |
| `--el-color-primary-light-7` | `#B2CBFF` | 浅背景激活态 · Tag 边框、朴素按钮边框 |
| `--el-color-primary` | `#216BFF` | 主色 |
| `--el-color-primary-light-3` | `#4D89FF` | 悬浮态 · 实心按钮 hover |
| `--el-color-primary-dark-2` | `#114DD9` | 激活态 · 实心按钮按下 |
| `--el-color-primary-light-5` | `#B2CBFF` | 禁用态 · 实心按钮禁用底与边框 |

## 成功色 Success

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-color-success-light-9` | `#E5F7E1` | 最浅背景填充 · Menu hover 底、选中行底 |
| `--el-color-success-light-8` | `#B2E6AA` | 浅背景悬浮态 · Tag 浅底 |
| `--el-color-success-light-7` | `#87D97E` | 浅背景激活态 · Tag 边框、朴素按钮边框 |
| `--el-color-success` | `#12B312` | 主色 |
| `--el-color-success-light-3` | `#36BF32` | 悬浮态 · 实心按钮 hover |
| `--el-color-success-dark-2` | `#078C0B` | 激活态 · 实心按钮按下 |
| `--el-color-success-light-5` | `#87D97E` | 禁用态 · 实心按钮禁用底与边框 |

## 警告色 Warning

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-color-warning-light-9` | `#FFF7E6` | 最浅背景填充 · Menu hover 底、选中行底 |
| `--el-color-warning-light-8` | `#FFE2B0` | 浅背景悬浮态 · Tag 浅底 |
| `--el-color-warning-light-7` | `#FFCF87` | 浅背景激活态 · Tag 边框、朴素按钮边框 |
| `--el-color-warning` | `#FA830C` | 主色 |
| `--el-color-warning-light-3` | `#FFA136` | 悬浮态 · 实心按钮 hover |
| `--el-color-warning-dark-2` | `#D46300` | 激活态 · 实心按钮按下 |
| `--el-color-warning-light-5` | `#FFCF87` | 禁用态 · 实心按钮禁用底与边框 |

## 危险色 Danger

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-color-danger-light-9` | `#FFF1F0` | 最浅背景填充 · Menu hover 底、选中行底 |
| `--el-color-danger-light-8` | `#FFE0DE` | 浅背景悬浮态 · Tag 浅底 |
| `--el-color-danger-light-7` | `#FFB7B5` | 浅背景激活态 · Tag 边框、朴素按钮边框 |
| `--el-color-danger` | `#FA3946` | 主色 |
| `--el-color-danger-light-3` | `#FF6369` | 悬浮态 · 实心按钮 hover |
| `--el-color-danger-dark-2` | `#D42638` | 激活态 · 实心按钮按下 |
| `--el-color-danger-light-5` | `#FFB7B5` | 禁用态 · 实心按钮禁用底与边框 |

## 错误色 Error（与 Danger 同值）

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-color-error-light-9` | `#FFF1F0` | 最浅背景填充 · Menu hover 底、选中行底 |
| `--el-color-error-light-8` | `#FFE0DE` | 浅背景悬浮态 · Tag 浅底 |
| `--el-color-error-light-7` | `#FFB7B5` | 浅背景激活态 · Tag 边框、朴素按钮边框 |
| `--el-color-error` | `#FA3946` | 主色 |
| `--el-color-error-light-3` | `#FF6369` | 悬浮态 · 实心按钮 hover |
| `--el-color-error-dark-2` | `#D42638` | 激活态 · 实心按钮按下 |
| `--el-color-error-light-5` | `#FFB7B5` | 禁用态 · 实心按钮禁用底与边框 |

## 信息色 Info

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-color-info` | `#8E8E8E` | 中性提示、次要信息 |
| `--el-color-info-light-9` | `#F2F2F2` | info 类 Tag/Alert 浅底 |
| `--el-color-info-light-8` | `#EDEDED` | info 浅底悬浮 |
| `--el-color-info-light-7` | `#E9E9E9` | info Tag 边框 |
| `--el-color-info-light-3` | `#BFBFBF` | info hover |
| `--el-color-info-dark-2` | `#6A6A6A` | info active |

## 背景色 Background

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-bg-color` | `#FFFFFF` | 卡片、面板、Table 主底色 |
| `--el-bg-color-overlay` | `#FFFFFF` | Dialog、Popover、Dropdown 浮层 |
| `--el-bg-color-page` | `#F7F7F7` | 页面最底层布局底色 |

## 填充色 Fill

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-fill-color-blank` | `#FFFFFF` | 输入框、Checkbox 空白底 |
| `--el-fill-color` | `#F2F2F2` | 标准填充、hover 底色 |
| `--el-fill-color-light` | `#F2F2F2` | Table 表头、禁用底色 |
| `--el-fill-color-lighter` | `#F7F7F7` | Table 斑马纹 · 规范无此档，取布局底色 |
| `--el-fill-color-extra-light` | `#F7F7F7` | 最浅填充 · 规范无此档 |
| `--el-fill-color-dark` | `#EDEDED` | 按下态、active 底色 |
| `--el-fill-color-darker` | `#EDEDED` | 最深填充 · 与 dark 同值 |

## 文字色 Text

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-text-color-primary` | `#141414` | 标题、强调正文 |
| `--el-text-color-regular` | `#6A6A6A` | 正文、表格内容主色 |
| `--el-text-color-secondary` | `#8E8E8E` | 辅助说明、表头次要文字 |
| `--el-text-color-placeholder` | `#8E8E8E` | 输入框占位文字 |
| `--el-text-color-disabled` | `#BFBFBF` | 禁用态文字 |

## 边框色 Border

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-border-color` | `#E9E9E9` | 输入框、卡片标准边框 |
| `--el-border-color-light` | `#E9E9E9` | 分割线 · 与 base 同值 |
| `--el-border-color-lighter` | `#F0F0F0` | Table 行分割线 |
| `--el-border-color-extra-light` | `#F0F0F0` | 最浅边框 · 与 lighter 同值 |
| `--el-border-color-dark` | `#E9E9E9` | 强调边框 · 规范无更深档 |
| `--el-border-color-darker` | `#E9E9E9` | 最深边框 · 规范无更深档 |

## 遮罩 Mask / Overlay

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-mask-color` | `rgba(255,255,255,0.9)` | Loading 全屏与区域遮罩 |
| `--el-mask-color-extra-light` | `rgba(255,255,255,0.3)` | 轻量遮罩，内容仍可见 |
| `--el-overlay-color` | `rgba(20,20,20,0.8)` | 最深浮层遮罩 |
| `--el-overlay-color-light` | `rgba(20,20,20,0.7)` | 中等浮层遮罩 |
| `--el-overlay-color-lighter` | `rgba(20,20,20,0.5)` | Dialog 默认取此档 |

## 投影 Box Shadow

| Element 变量 | 修改后色值 | 用途 · 影响组件 |
| --- | --- | --- |
| `--el-box-shadow` | `0 12px 32px 4px rgba(0,0,0,.04), 0 8px 20px rgba(0,0,0,.08)` | 卡片、Dialog 标准投影 |
| `--el-box-shadow-light` | `0 0 12px rgba(0,0,0,.12)` | Select 下拉、Popover |
| `--el-box-shadow-lighter` | `0 0 6px rgba(0,0,0,.12)` | Tooltip |
| `--el-box-shadow-dark` | `0 16px 48px 16px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.12)` | Drawer 重投影 |

## 自动继承 · 无需单独处理

以下变量在 Element 源码中本身就是 `var()` 引用上层 token，改完前面的分组后会自动跟随，**不需要单独修改**。

| Element 变量 | 引用关系 |
| --- | --- |
| `--el-disabled-bg-color` | 继承 --el-fill-color-light → #F2F2F2 |
| `--el-disabled-text-color` | 继承 --el-text-color-placeholder → #8E8E8E |
| `--el-disabled-border-color` | 继承 --el-border-color-light → #E9E9E9 |
| `--el-border-color-hover` | 继承 --el-text-color-disabled → #BFBFBF |
| `--el-menu-active-color` | 继承 --el-color-primary → #216BFF |
| `--el-menu-hover-bg-color` | 继承 --el-color-primary-light-9 → #EBF1FF |
| `--el-menu-text-color` | 继承 --el-text-color-primary → #141414 |
| `--el-menu-bg-color` | 继承 --el-fill-color-blank → #FFFFFF |
| `--el-menu-border-color` | 继承 --el-border-color → #E9E9E9 |
| `--el-popup-modal-bg-color` | 继承 --el-color-black → #000000 |
| `--el-menu-item-hover-fill` | 继承 --el-color-primary-light-9 → #EBF1FF |

---

## 分组统计

| 分组 | 变量数 |
| --- | --- |
| 品牌主色 Primary | 7 |
| 成功色 Success | 7 |
| 警告色 Warning | 7 |
| 危险色 Danger | 7 |
| 错误色 Error（与 Danger 同值） | 7 |
| 信息色 Info | 6 |
| 背景色 Background | 3 |
| 填充色 Fill | 7 |
| 文字色 Text | 5 |
| 边框色 Border | 6 |
| 遮罩 Mask / Overlay | 5 |
| 投影 Box Shadow | 4 |
| 自动继承 · 无需单独处理 | 11 |

---

## 可直接使用的覆盖代码

将下方代码保存为 `element-theme.css`，在全局样式中**于 element-plus 样式之后**引入即可：

```css
/* iWorker 管理后台 · Element Plus 颜色 Token 改造
   基准 Element Plus 2.9.1 · 与 MasterGo 对照表逐值一致
   生成日期 2026-08-20 */

:root {

  /* ---- 品牌主色 Primary ---- */
  --el-color-primary-light-9:        #EBF1FF;                                                   /* 最浅背景填充 · Menu hover 底、选中行底 */
  --el-color-primary-light-8:        #D3E1FF;                                                   /* 浅背景悬浮态 · Tag 浅底 */
  --el-color-primary-light-7:        #B2CBFF;                                                   /* 浅背景激活态 · Tag 边框、朴素按钮边框 */
  --el-color-primary:                #216BFF;                                                   /* 主色 */
  --el-color-primary-light-3:        #4D89FF;                                                   /* 悬浮态 · 实心按钮 hover */
  --el-color-primary-dark-2:         #114DD9;                                                   /* 激活态 · 实心按钮按下 */
  --el-color-primary-light-5:        #B2CBFF;                                                   /* 禁用态 · 实心按钮禁用底与边框 */

  /* ---- 成功色 Success ---- */
  --el-color-success-light-9:        #E5F7E1;                                                   /* 最浅背景填充 · Menu hover 底、选中行底 */
  --el-color-success-light-8:        #B2E6AA;                                                   /* 浅背景悬浮态 · Tag 浅底 */
  --el-color-success-light-7:        #87D97E;                                                   /* 浅背景激活态 · Tag 边框、朴素按钮边框 */
  --el-color-success:                #12B312;                                                   /* 主色 */
  --el-color-success-light-3:        #36BF32;                                                   /* 悬浮态 · 实心按钮 hover */
  --el-color-success-dark-2:         #078C0B;                                                   /* 激活态 · 实心按钮按下 */
  --el-color-success-light-5:        #87D97E;                                                   /* 禁用态 · 实心按钮禁用底与边框 */

  /* ---- 警告色 Warning ---- */
  --el-color-warning-light-9:        #FFF7E6;                                                   /* 最浅背景填充 · Menu hover 底、选中行底 */
  --el-color-warning-light-8:        #FFE2B0;                                                   /* 浅背景悬浮态 · Tag 浅底 */
  --el-color-warning-light-7:        #FFCF87;                                                   /* 浅背景激活态 · Tag 边框、朴素按钮边框 */
  --el-color-warning:                #FA830C;                                                   /* 主色 */
  --el-color-warning-light-3:        #FFA136;                                                   /* 悬浮态 · 实心按钮 hover */
  --el-color-warning-dark-2:         #D46300;                                                   /* 激活态 · 实心按钮按下 */
  --el-color-warning-light-5:        #FFCF87;                                                   /* 禁用态 · 实心按钮禁用底与边框 */

  /* ---- 危险色 Danger ---- */
  --el-color-danger-light-9:         #FFF1F0;                                                   /* 最浅背景填充 · Menu hover 底、选中行底 */
  --el-color-danger-light-8:         #FFE0DE;                                                   /* 浅背景悬浮态 · Tag 浅底 */
  --el-color-danger-light-7:         #FFB7B5;                                                   /* 浅背景激活态 · Tag 边框、朴素按钮边框 */
  --el-color-danger:                 #FA3946;                                                   /* 主色 */
  --el-color-danger-light-3:         #FF6369;                                                   /* 悬浮态 · 实心按钮 hover */
  --el-color-danger-dark-2:          #D42638;                                                   /* 激活态 · 实心按钮按下 */
  --el-color-danger-light-5:         #FFB7B5;                                                   /* 禁用态 · 实心按钮禁用底与边框 */

  /* ---- 错误色 Error（与 Danger 同值） ---- */
  --el-color-error-light-9:          #FFF1F0;                                                   /* 最浅背景填充 · Menu hover 底、选中行底 */
  --el-color-error-light-8:          #FFE0DE;                                                   /* 浅背景悬浮态 · Tag 浅底 */
  --el-color-error-light-7:          #FFB7B5;                                                   /* 浅背景激活态 · Tag 边框、朴素按钮边框 */
  --el-color-error:                  #FA3946;                                                   /* 主色 */
  --el-color-error-light-3:          #FF6369;                                                   /* 悬浮态 · 实心按钮 hover */
  --el-color-error-dark-2:           #D42638;                                                   /* 激活态 · 实心按钮按下 */
  --el-color-error-light-5:          #FFB7B5;                                                   /* 禁用态 · 实心按钮禁用底与边框 */

  /* ---- 信息色 Info ---- */
  --el-color-info:                   #8E8E8E;                                                   /* 中性提示、次要信息 */
  --el-color-info-light-9:           #F2F2F2;                                                   /* info 类 Tag/Alert 浅底 */
  --el-color-info-light-8:           #EDEDED;                                                   /* info 浅底悬浮 */
  --el-color-info-light-7:           #E9E9E9;                                                   /* info Tag 边框 */
  --el-color-info-light-3:           #BFBFBF;                                                   /* info hover */
  --el-color-info-dark-2:            #6A6A6A;                                                   /* info active */

  /* ---- 背景色 Background ---- */
  --el-bg-color:                     #FFFFFF;                                                   /* 卡片、面板、Table 主底色 */
  --el-bg-color-overlay:             #FFFFFF;                                                   /* Dialog、Popover、Dropdown 浮层 */
  --el-bg-color-page:                #F7F7F7;                                                   /* 页面最底层布局底色 */

  /* ---- 填充色 Fill ---- */
  --el-fill-color-blank:             #FFFFFF;                                                   /* 输入框、Checkbox 空白底 */
  --el-fill-color:                   #F2F2F2;                                                   /* 标准填充、hover 底色 */
  --el-fill-color-light:             #F2F2F2;                                                   /* Table 表头、禁用底色 */
  --el-fill-color-lighter:           #F7F7F7;                                                   /* Table 斑马纹 · 规范无此档，取布局底色 */
  --el-fill-color-extra-light:       #F7F7F7;                                                   /* 最浅填充 · 规范无此档 */
  --el-fill-color-dark:              #EDEDED;                                                   /* 按下态、active 底色 */
  --el-fill-color-darker:            #EDEDED;                                                   /* 最深填充 · 与 dark 同值 */

  /* ---- 文字色 Text ---- */
  --el-text-color-primary:           #141414;                                                   /* 标题、强调正文 */
  --el-text-color-regular:           #6A6A6A;                                                   /* 正文、表格内容主色 */
  --el-text-color-secondary:         #8E8E8E;                                                   /* 辅助说明、表头次要文字 */
  --el-text-color-placeholder:       #8E8E8E;                                                   /* 输入框占位文字 */
  --el-text-color-disabled:          #BFBFBF;                                                   /* 禁用态文字 */

  /* ---- 边框色 Border ---- */
  --el-border-color:                 #E9E9E9;                                                   /* 输入框、卡片标准边框 */
  --el-border-color-light:           #E9E9E9;                                                   /* 分割线 · 与 base 同值 */
  --el-border-color-lighter:         #F0F0F0;                                                   /* Table 行分割线 */
  --el-border-color-extra-light:     #F0F0F0;                                                   /* 最浅边框 · 与 lighter 同值 */
  --el-border-color-dark:            #E9E9E9;                                                   /* 强调边框 · 规范无更深档 */
  --el-border-color-darker:          #E9E9E9;                                                   /* 最深边框 · 规范无更深档 */

  /* ---- 遮罩 Mask / Overlay ---- */
  --el-mask-color:                   rgba(255,255,255,0.9);                                     /* Loading 全屏与区域遮罩 */
  --el-mask-color-extra-light:       rgba(255,255,255,0.3);                                     /* 轻量遮罩，内容仍可见 */
  --el-overlay-color:                rgba(20,20,20,0.8);                                        /* 最深浮层遮罩 */
  --el-overlay-color-light:          rgba(20,20,20,0.7);                                        /* 中等浮层遮罩 */
  --el-overlay-color-lighter:        rgba(20,20,20,0.5);                                        /* Dialog 默认取此档 */

  /* ---- 投影 Box Shadow ---- */
  --el-box-shadow:                   0 12px 32px 4px rgba(0,0,0,.04), 0 8px 20px rgba(0,0,0,.08); /* 卡片、Dialog 标准投影 */
  --el-box-shadow-light:             0 0 12px rgba(0,0,0,.12);                                  /* Select 下拉、Popover */
  --el-box-shadow-lighter:           0 0 6px rgba(0,0,0,.12);                                   /* Tooltip */
  --el-box-shadow-dark:              0 16px 48px 16px rgba(0,0,0,.08), 0 12px 32px rgba(0,0,0,.12); /* Drawer 重投影 */

  /* ---- 自动继承 · 无需单独处理（Element 源码内部已 var() 引用，列出仅供核对，无需覆盖）---- */
  /* --el-disabled-bg-color:          继承 --el-fill-color-light → #F2F2F2 */
  /* --el-disabled-text-color:        继承 --el-text-color-placeholder → #8E8E8E */
  /* --el-disabled-border-color:      继承 --el-border-color-light → #E9E9E9 */
  /* --el-border-color-hover:         继承 --el-text-color-disabled → #BFBFBF */
  /* --el-menu-active-color:          继承 --el-color-primary → #216BFF */
  /* --el-menu-hover-bg-color:        继承 --el-color-primary-light-9 → #EBF1FF */
  /* --el-menu-text-color:            继承 --el-text-color-primary → #141414 */
  /* --el-menu-bg-color:              继承 --el-fill-color-blank → #FFFFFF */
  /* --el-menu-border-color:          继承 --el-border-color → #E9E9E9 */
  /* --el-popup-modal-bg-color:       继承 --el-color-black → #000000 */
  /* --el-menu-item-hover-fill:       继承 --el-color-primary-light-9 → #EBF1FF */
}
```

引入示例（Vue 3 + Vite）：

```ts
// main.ts
import 'element-plus/dist/index.css'
import './styles/element-theme.css'  // 必须在 element-plus 之后
```

---

## 遗留待定项

以下两处规范本身缺档，当前取了同族最接近值，建议后续在规范中补齐：

| 项 | 现状 | 建议 |
| --- | --- | --- |
| 边框 `dark` / `darker` | 规范只有一级 `#E9E9E9`、二级 `#F0F0F0`，无更深档，两档同取 `#E9E9E9` | 若系统中用到深色边框，需在规范补一档更深灰 |
| 遮罩与投影 | 规范未定义，遮罩取 `rgba(20,20,20,x)`（与一级文字色同源），投影沿用 Element 默认参数 | 建议在规范中正式补一组 mask / shadow token |

另：规范截图中三级文本色与四级文本色均为 `#8E8E8E`，而 MasterGo 文件变量中四级为 `#999999`，本表按截图取值。
